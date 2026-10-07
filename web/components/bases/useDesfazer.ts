"use client";
// components/bases/useDesfazer.ts
// O Ctrl+Z e o refazer da Base na tela (Spec 056, fatia H). QUANDO o atalho
// vale e QUE aviso mostrar é de `lib/baseDesfazer.ts` (puro, testado); aqui é
// só escutar a tecla, chamar o servidor e recarregar.
//
// ⚠️ ANTES DE DESFAZER, GRAVA O QUE ESTÁ PENDENTE (`antes`): a visão grava com
// 600 ms de atraso, e um Ctrl+Z logo depois de mexer num filtro desfaria a
// ação ANTERIOR -- a do filtro ainda nem chegou ao servidor.
//
// ⚠️ UM DE CADA VEZ: segurar o Ctrl+Z dispara a tecla em repetição, e dez
// pedidos em paralelo desfariam dez ações sem a pessoa ver nenhuma.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAvisar } from "@/components/Toasts";
import { ApiError, redoBase, undoBase } from "@/lib/api";
import {
  atalhoDeDesfazer,
  editaTextoSozinho,
  mensagemDoDesfazer,
  type AcaoDeDesfazer,
} from "@/lib/baseDesfazer";

export function useDesfazer(
  baseId: string,
  aoAplicar: () => void,
  antes: () => Promise<void> = async () => {}
): { rodar: (acao: AcaoDeDesfazer) => Promise<void>; ocupado: boolean } {
  const avisar = useAvisar();
  const [ocupado, setOcupado] = useState(false);
  const emCurso = useRef(false);
  const aoAplicarRef = useRef(aoAplicar);
  aoAplicarRef.current = aoAplicar;
  const antesRef = useRef(antes);
  antesRef.current = antes;

  const rodar = useCallback(
    async (acao: AcaoDeDesfazer) => {
      if (emCurso.current) return;
      emCurso.current = true;
      setOcupado(true);
      try {
        await antesRef.current();
        const r = await (acao === "undo" ? undoBase(baseId) : redoBase(baseId));
        avisar(mensagemDoDesfazer(acao, r));
        if (r.applied) aoAplicarRef.current();
      } catch (e) {
        avisar((e as ApiError).message || "Não consegui desfazer.");
      } finally {
        emCurso.current = false;
        setOcupado(false);
      }
    },
    [baseId, avisar]
  );

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const acao = atalhoDeDesfazer({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        emCampoDeTexto: editaTextoSozinho(e.target as HTMLElement | null),
      });
      if (!acao) return;
      e.preventDefault();
      void rodar(acao);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [rodar]);

  return { rodar, ocupado };
}
