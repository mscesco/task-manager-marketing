"use client";
// A descrição do projeto, com o começo à vista e "Ver mais". O botão só aparece
// quando o texto passa do corte, medido no navegador (o tamanho da string não diz).

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import TextoFormatado from "@/components/TextoFormatado";

export default function SobreOProjeto({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false);
  const [passaDoCorte, setPassaDoCorte] = useState(false);
  const corpo = useRef<HTMLDivElement>(null);
  const id = useId();

  // Medir só fechado: aberto não há corte, e o "Ver menos" sumiria.
  // `useLayoutEffect` mede antes da pintura, para o bloco não pular.
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
      {/* O `line-clamp-2` fica no bloco de fora e corta atravessando parágrafos e listas. */}
      <div id={id} ref={corpo} className={aberto ? "" : "line-clamp-2"}>
        <TextoFormatado texto={texto} />
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
