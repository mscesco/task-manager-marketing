// lib/motion.ts
// O vocabulário de movimento do redesign (19/10), em segundos, para o `motion`.
//
// ⚠️⚠️ ESPELHA O `globals.css` (`--dur-1..4`, `--ease-out`, `--ease-io`), e o
// teste `motion.test.ts` LÊ o CSS e confere os números: mudar um lado sem o
// outro reprova. O CSS fala em ms; o `motion` fala em segundos.
//
// ⚠️ Quem anima com `motion` não enxerga o bloco de `prefers-reduced-motion`
// do CSS. Use `useReducedMotion` (ou um `MotionConfig reducedMotion="user"`)
// no componente -- ver `Entrada.tsx`.

/** Durações, em segundos: 1 = hover/saída, 2 = controle, 3 = painel, 4 = entrada. */
export const DUR = { 1: 0.12, 2: 0.2, 3: 0.32, 4: 0.56 } as const;

/** As duas curvas: `out` para quem chega, `io` para quem muda de lugar ou sai. */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  io: [0.65, 0, 0.35, 1],
} as const;
