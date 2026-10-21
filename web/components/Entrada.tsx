"use client";
// components/Entrada.tsx
// A entrada escalonada do redesign (19/10): cada vizinho sobe 10px com
// opacidade em `--dur-4`, 40ms depois do anterior.
//
// ⚠️ NO MÁXIMO OITO ESCALONADOS; do nono em diante, todos juntos. Uma lista de
// 40 linhas com 40ms entre cada uma levaria 1,6s para terminar de chegar -- e
// quem usa o app o dia inteiro olharia para a última linha esperando.
//
// ⚠️ DUAS FORMAS, pelo mesmo motivo que o `Card` é casca: a coluna do quadro
// é um `flex: 1` com `ref` do dnd-kit, e a linha da fila é um `motion.li`
// com `layout` e saída própria. Embrulhar esses num `<div>` quebraria o
// layout, então eles pegam só as PROPRIEDADES (`useEntrada`) e continuam sendo
// a própria raiz. Onde um bloco a mais não atrapalha (a faixa de projeto),
// o componente embrulha cada filho.
//
// ⚠️ `useReducedMotion`, e não o bloco do `globals.css`: aquele só alcança
// animação de CSS. Com menos movimento, nada nasce invisível.
//
// ⚠️ O quadro NÃO escalona card a card: são centenas. Escalona por coluna.

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
 * As propriedades do `motion` para o item de posição `ordem`.
 *
 * ⚠️ A transição mora DENTRO do `animate`, e não na prop `transition`: a
 * linha da fila tem `layout`, e a prop valeria para o deslize também -- com
 * o atraso da entrada em cada reordenação.
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
