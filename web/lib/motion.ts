// O vocabulário de movimento, em segundos, para o `motion`. Espelha o
// `globals.css` (`--dur-1..4`, `--ease-out`, `--ease-io`, em ms), e o
// `motion.test.ts` confere os dois. Quem anima com `motion` não vê o
// `prefers-reduced-motion` do CSS: use `useReducedMotion` (ver `Entrada.tsx`).

/** Durações, em segundos: 1 = hover/saída, 2 = controle, 3 = painel, 4 = entrada. */
export const DUR = { 1: 0.12, 2: 0.2, 3: 0.32, 4: 0.56 } as const;

/** As duas curvas: `out` para quem chega, `io` para quem muda de lugar ou sai. */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  io: [0.65, 0, 0.35, 1],
} as const;
