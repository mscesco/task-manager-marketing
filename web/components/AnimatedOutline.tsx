"use client";
// Contorno animado dos cartões: um traço curto que corre o perímetro e para no
// meio da base. `pathLength` fixo é o tamanho do traço; `pathOffset` é o que anima
// (ambos normalizados 0–1, sem precisar do perímetro em pixels). `<path>` e não
// `<rect>` para escolher onde o traço nasce e morre. Decoração: `aria-hidden` e
// sem clique.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
// A geometria mora em `lib/` porque em jsdom o `<svg>` nunca monta.
import { outlinePath, STROKE_WIDTH } from "@/lib/outline";

/** Quanto do perímetro o traço ocupa. */
const TAMANHO_DO_TRACO = 0.22;

/**
 * O raio real da superfície, lido do CSS do pai. `rounded-lg` aqui é 12px
 * (`--radius-lg` no `@theme`), não os 8 do Tailwind padrão.
 */
function cssRadiusOf(el: Element): number | null {
  const pai = el.parentElement;
  if (!pai) return null;
  // "" em jsdom, "0px" sem raio: os dois viram `null`/0 sem estourar.
  const bruto = getComputedStyle(pai).borderTopLeftRadius;
  // `parseFloat` leria "50%" como 50px; melhor desistir.
  if (!bruto || bruto.includes("%")) return null;
  const n = Number.parseFloat(bruto);
  return Number.isFinite(n) ? n : null;
}

export default function AnimatedOutline({
  show,
  radius,
}: {
  show: boolean;
  /** Raio em pixels, só de reserva quando ler o CSS falha. O normal é não passar. */
  radius?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [measured, setMeasured] = useState<{
    w: number;
    h: number;
    r: number;
  } | null>(null);

  // Remede a cada redimensionamento (coluna da grade, zoom); o raio junto, que muda com o tema.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () =>
      setMeasured({
        w: el.offsetWidth,
        h: el.offsetHeight,
        r: cssRadiusOf(el) ?? radius ?? 0,
      });
    medir();
    // jsdom não tem `ResizeObserver`; sem ele vale só a medida única.
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [radius]);

  return (
    // `<span>`, não `<div>`: o contorno também vive dentro de `<button>`.
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 block"
    >
      {measured && measured.w > 0 && (
        <svg
          className="absolute inset-0"
          width={measured.w}
          height={measured.h}
          viewBox={`0 0 ${measured.w} ${measured.h}`}
        >
          <motion.path
            d={outlinePath(measured.w, measured.h, measured.r)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            // Fixo: é o tamanho do traço, não o progresso.
            pathLength={TAMANHO_DO_TRACO}
            initial={false}
            animate={{
              // O traço nasce escondido antes do início e para com a ponta
              // no fim do caminho — o meio da base.
              pathOffset: show ? 1 - TAMANHO_DO_TRACO : -TAMANHO_DO_TRACO,
              opacity: show ? 1 : 0,
            }}
            transition={{
              // `ease` e não mola: a mola rastejaria na chegada ao meio da base.
              pathOffset: { duration: 0.85, ease: "easeInOut" },
              // A opacidade só acompanha; se durasse o mesmo, o traço
              // apareceria por transparência em vez de correr.
              opacity: { duration: show ? 0.05 : 0.25 },
            }}
          />
        </svg>
      )}
    </span>
  );
}

/**
 * Gancho que devolve os handlers e o contorno, deixando a tag no chamador:
 *
 *     const { target, outline } = useDrawnOutline();
 *     <a {...target} className="relative …">{outline}…</a>
 *
 * O chamador precisa de `relative`, senão o contorno mede o ancestral errado.
 * Hover e foco acendem. Não passe `radius`: o raio é lido do CSS.
 */
export function useDrawnOutline(radius?: number) {
  const [lit, setLit] = useState(false);
  const target = useMemo(
    () => ({
      onMouseEnter: () => setLit(true),
      onMouseLeave: () => setLit(false),
      onFocus: () => setLit(true),
      onBlur: () => setLit(false),
    }),
    [],
  );
  return {
    target,
    outline: <AnimatedOutline show={lit} radius={radius} />,
  };
}
