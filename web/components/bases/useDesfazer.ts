"use client";
// Ctrl+Z e refazer da Base: escuta a tecla, chama o servidor e recarrega. Quando o
// atalho vale e que aviso mostrar fica em `lib/baseDesfazer.ts`.
// Antes de desfazer, grava o pendente (`antes`): a visão grava com 600 ms de atraso.
// Um pedido por vez: segurar o Ctrl+Z repete a tecla.

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
