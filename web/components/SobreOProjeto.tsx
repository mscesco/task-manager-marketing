"use client";
// components/SobreOProjeto.tsx
// A descrição do projeto, com o COMEÇO à vista e "Ver mais" (Spec 052, fatia A).
//
// ⚠️⚠️ ELA MORAVA NA LINHA DO CABEÇALHO, cortada em UMA linha com reticências e
// o texto inteiro só no `title`. A Camila, em 16/09, com o projeto CBV na tela:
// *"a descrição desse projeto é enorme e só tem uma linha aparecendo (...) só
// consigo colar aqui porque dei aquele clique duplo pra copiar, porque nem vejo
// esse resto"*. E pediu a forma: *"algo tipo com o inicio dela e depois um 'ver
// mais'"*.
//
// ⚠️ O "VER MAIS" SÓ APARECE QUANDO O TEXTO PASSA DO CORTE, e isso é MEDIDO no
// navegador, não adivinhado pelo tamanho da string: 300 caracteres sem quebra
// cabem em 4 linhas numa tela larga e não numa estreita, e 5 linhas curtas
// passam do corte com 40 caracteres. Um botão que não abre nada é pior que
// nenhum.
//
// ⚠️ SÓ NO PROJETO. A descrição da TAREFA continua inteira no detalhe --
// decisão dela, no mesmo dia: *"na tarefa pode deixar como é hoje"*.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { linkify } from "@/lib/linkify";

export default function SobreOProjeto({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const [passaDoCorte, setPassaDoCorte] = useState(false);
  const corpo = useRef<HTMLDivElement>(null);
  const id = useId();

  // ⚠️ MEDIR SÓ FECHADO: aberto, o bloco não tem corte, e `scrollHeight ===
  // clientHeight` apagaria o "Ver menos" que a pessoa acabou de usar.
  // `useLayoutEffect` para medir antes da pintura: com `useEffect`, o botão
  // apareceria um quadro depois do texto, e o bloco pularia.
  useLayoutEffect(() => {
    if (aberto) return;
    const el = corpo.current;
    if (!el) return;
    setPassaDoCorte(el.scrollHeight > el.clientHeight + 1);
  }, [texto, aberto]);

  // A largura muda (janela, barra lateral recolhida) e o corte muda junto.
  useEffect(() => {
    const el = corpo.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      if (aberto) return;
      setPassaDoCorte(el.scrollHeight > el.clientHeight + 1);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [aberto]);

  return (
    <section className="mb-4" aria-label="Sobre o projeto">
      <h2 className="label mb-1">Sobre o projeto</h2>
      {/* ⚠️ `whitespace-pre-wrap` mantém as quebras de linha como foram
          digitadas, e `wrap-anywhere` quebra URL comprida sem hífen, que
          vazaria a largura -- o mesmo tratamento da descrição da tarefa. */}
      <div
        id={id}
        ref={corpo}
        className={
          "whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed" +
          (aberto ? "" : " line-clamp-4")
        }
      >
        {linkify(texto, "sobre-")}
      </div>
      {(passaDoCorte || aberto) && (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-accent hover:underline"
          aria-expanded={aberto}
          aria-controls={id}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </section>
  );
}
