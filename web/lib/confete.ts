// lib/confete.ts
// O confete de concluir uma tarefa (pedido dela, 21/10, com a referência do
// motion.dev): uma explosão curta de partículas que sai DE ONDE o gesto
// aconteceu -- a caixinha da subtarefa, o card arrastado, o seletor de coluna
// -- e não da tela inteira.
//
// ⚠️ IMPERATIVO DE PROPÓSITO: quem conclui é um `onDragEnd`, um `onChange` ou
// um `await updateTask`, em três componentes diferentes. Um componente de
// React com estado em cada um deles seria três vezes o mesmo código; aqui o
// chamador só diz de onde.
//
// ⚠️ SÓ `transform` E `opacity` (§7 do `web/AGENTS.md`), e nada acontece com
// `prefers-reduced-motion` -- a conclusão em si não depende do confete.

import { animate } from "motion";

/** Quantas partículas por explosão. */
export const CONFETE_PARTICULAS = 22;

/** As cores de apoio do redesign; os tokens mudam por tema. */
const CORES = ["var(--accent)", "var(--teal)", "var(--amber)", "var(--violet)", "var(--danger)"];

export type Ponto = { x: number; y: number };

function preferindoMenosMovimento(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function centroDe(origem: HTMLElement | Ponto | null | undefined): Ponto | null {
  if (!origem) return null;
  if (origem instanceof HTMLElement) {
    const r = origem.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return origem;
}

/**
 * Solta o confete a partir de um elemento ou de um ponto da tela (viewport).
 * Nunca lança: falhar aqui não pode derrubar a conclusão que acabou de dar
 * certo.
 */
export function soltarConfete(origem: HTMLElement | Ponto | null | undefined): void {
  if (typeof document === "undefined" || preferindoMenosMovimento()) return;
  const centro = centroDe(origem);
  if (!centro) return;

  const caixa = document.createElement("div");
  caixa.setAttribute("aria-hidden", "true");
  caixa.dataset.confete = "";
  Object.assign(caixa.style, {
    position: "fixed",
    left: `${centro.x}px`,
    top: `${centro.y}px`,
    width: "0",
    height: "0",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(caixa);

  try {
    const voos = [];
    for (let i = 0; i < CONFETE_PARTICULAS; i++) {
      const p = document.createElement("span");
      const lado = 5 + Math.random() * 4;
      Object.assign(p.style, {
        position: "absolute",
        left: `${-lado / 2}px`,
        top: `${-lado / 2}px`,
        width: `${lado}px`,
        height: `${lado * (Math.random() < 0.5 ? 1 : 0.55)}px`,
        borderRadius: Math.random() < 0.4 ? "999px" : "2px",
        background: CORES[i % CORES.length],
        willChange: "transform, opacity",
      });
      caixa.appendChild(p);

      // Um cone para cima, velocidade aleatória, e a gravidade puxa no fim.
      const angulo = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const velocidade = 70 + Math.random() * 110;
      const dx = Math.cos(angulo) * velocidade;
      const dy = Math.sin(angulo) * velocidade;
      const queda = 90 + Math.random() * 70;
      voos.push(
        animate(
          p,
          {
            x: [0, dx, dx * 1.15],
            y: [0, dy, dy + queda],
            rotate: [0, (Math.random() - 0.5) * 720],
            scale: [0.5, 1, 0.6],
            opacity: [1, 1, 0],
          },
          { duration: 0.75 + Math.random() * 0.35, ease: "easeOut" }
        )
      );
    }
    Promise.all(voos).then(() => caixa.remove(), () => caixa.remove());
  } catch {
    caixa.remove();
  }
}
