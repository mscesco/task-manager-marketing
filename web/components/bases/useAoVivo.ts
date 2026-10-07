"use client";
// components/bases/useAoVivo.ts
// Mantém aberto o canal ao vivo de uma base e chama `aoMudar` quando OUTRA
// pessoa mexe nela (Spec 056, fatia G, §10).
//
// ⚠️ O AVISO NÃO TRAZ OS DADOS -- ele diz "mudou", e quem recebe recarrega
// (`aoMudar`). Vários avisos em sequência viram UMA recarga (300 ms).
//
// ⚠️ O CANAL VENCE EM 60 s (o servidor manda `end`), e reabrir é o normal,
// não o erro: cada reabertura confere de novo se a pessoa ainda lê a base.
// Ao reabrir, recarrega -- o que mudou na troca não se perde.
//
// ⚠️ CAIU (rede, 401, servidor fora): espera 1, 2, 4… até 30 s e tenta de novo.
// Enquanto não está conectado, a página volta à recarga de 10 s -- o canal é
// um atalho, nunca o único caminho.
//
// O eco: aviso de uma ação DA PRÓPRIA pessoa não recarrega -- a tela dela já
// tem o que gravou.

import { useEffect, useRef, useState } from "react";
import { abrirCanalDaBase } from "@/lib/api";
import { esperaDeReconexao, lerEventos } from "@/lib/sse";

export function useAoVivo(
  baseId: string,
  meuId: string | null,
  aoMudar: () => void
): boolean {
  const [conectado, setConectado] = useState(false);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  const meuIdRef = useRef(meuId);
  meuIdRef.current = meuId;

  useEffect(() => {
    if (!baseId) return;
    let vivo = true;
    const ctrl = new AbortController();
    let adiado: ReturnType<typeof setTimeout> | undefined;
    const recarregarLogo = () => {
      clearTimeout(adiado);
      adiado = setTimeout(() => vivo && aoMudarRef.current(), 300);
    };
    const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function laco() {
      let tentativa = 0;
      while (vivo) {
        try {
          const res = await abrirCanalDaBase(baseId, ctrl.signal);
          if (!res.ok || !res.body) throw new Error(`canal ${res.status}`);
          const leitor = res.body.getReader();
          const decodificador = new TextDecoder();
          let resto = "";
          for (;;) {
            const { done, value } = await leitor.read();
            if (done || !vivo) break;
            const lido = lerEventos(resto + decodificador.decode(value, { stream: true }));
            resto = lido.resto;
            for (const ev of lido.eventos) {
              if (ev.evento === "ready") {
                tentativa = 0;
                setConectado(true);
              } else if (ev.evento === "unavailable") {
                throw new Error("canal indisponível");
              } else if (ev.evento === "message") {
                try {
                  const aviso = JSON.parse(ev.dados) as { actor_id?: string };
                  if (aviso.actor_id !== meuIdRef.current) recarregarLogo();
                } catch {
                  recarregarLogo();
                }
              }
            }
          }
          // Venceu (o normal) ou fechou: recarrega o que passou e reabre.
          if (vivo) aoMudarRef.current();
        } catch {
          if (!vivo) return;
          setConectado(false);
          await esperar(esperaDeReconexao(tentativa++));
          // A recarga passa pelo `api()`, que renova o token se ele venceu.
          if (vivo) aoMudarRef.current();
        }
      }
    }
    laco();
    return () => {
      vivo = false;
      ctrl.abort();
      clearTimeout(adiado);
      setConectado(false);
    };
  }, [baseId]);

  return conectado;
}
