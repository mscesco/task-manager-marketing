// O confete de concluir uma tarefa: uma explosão curta que sai de onde o
// gesto aconteceu. Imperativo porque quem conclui está em três componentes
// diferentes. Só `transform` e `opacity`, e nada com `prefers-reduced-motion`.

import { animate } from "motion";

/** Quantas partículas por explosão. */
export const CONFETE_PARTICULAS = 22;

/** As cores de apoio; os tokens mudam por tema. */
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
