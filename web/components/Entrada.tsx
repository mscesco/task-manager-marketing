"use client";
// A entrada escalonada: cada vizinho sobe 10px com opacidade em `--dur-4`,
// 40ms depois do anterior. No máximo oito escalonados; do nono em diante,
// todos juntos.
//
// Duas formas: `useEntrada` dá só as propriedades, para quem precisa continuar
// sendo a própria raiz (coluna do quadro, linha da fila); o componente embrulha
// cada filho. `useReducedMotion` porque o bloco do `globals.css` só alcança CSS.
// O quadro escalona por coluna, não por card.

import { Children, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";

/** Entre vizinhos, em segundos (40ms). */
export const ENTRADA_PASSO = 0.04;
/** Quantos ganham atraso próprio; os demais chegam com o último. */
export const ENTRADA_MAX = 8;

type PropsDeEntrada = {
  initial?: { opacity: number; y: number };
  animate?: {
    opacity: number;
    y: number;
    transition: { duration: number; ease: typeof EASE.out; delay: number };
  };
};

/**
 * As propriedades do `motion` para o item de posição `ordem`. A transição mora
 * dentro do `animate`: com `layout`, a prop `transition` atrasaria também cada
 * reordenação.
 */
export function propsDeEntrada(ordem: number, reduce: boolean | null): PropsDeEntrada {
  if (reduce) return {};
  return {
    initial: { opacity: 0, y: 10 },
    animate: {
      opacity: 1,
      y: 0,
      transition: {
        duration: DUR[4],
        ease: EASE.out,
        delay: Math.min(ordem, ENTRADA_MAX - 1) * ENTRADA_PASSO,
      },
    },
  };
}

/** Para quem precisa continuar sendo a própria raiz (coluna, `li`). */
export function useEntrada(ordem: number) {
  return propsDeEntrada(ordem, useReducedMotion());
}

/** Embrulha cada filho num bloco que entra escalonado. */
export default function Entrada({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return Children.map(children, (filho, i) => (
    <motion.div className={className} {...propsDeEntrada(i, reduce)}>
      {filho}
    </motion.div>
  ));
}
