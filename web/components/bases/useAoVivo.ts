"use client";
// Mantém aberto o canal ao vivo de uma base e chama `aoMudar` quando outra pessoa mexe nela.
// O aviso só diz "mudou"; vários seguidos viram uma recarga (300 ms).
// O canal vence em 60 s (`end`) e reabrir é o normal; ao reabrir, recarrega.
// Se cair, tenta de novo com espera de 1, 2, 4… até 30 s; enquanto isso a página volta à recarga de 10 s.
// Aviso de ação da própria pessoa não recarrega.

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
