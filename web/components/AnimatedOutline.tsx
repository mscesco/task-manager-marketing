"use client";
// components/AnimatedOutline.tsx
// O contorno que se DESENHA — Spec 047, revisão de 10/09.
//
// ⚠️⚠️ ELE SUBSTITUI O `outline` DO CSS nos cartões, e o pedido foi direto:
// *"esse contorno é bem feio, tem como mudar para algo (…) use essa svg
// animation pra contorno?"*. O `outline: 1px solid` do `.tappable:hover`
// aparece inteiro de uma vez, encostado no conteúdo, e não acompanha o raio
// do cartão — por isso lê como "erro de borda" e não como destaque.
//
// ⚠️ AQUI ELE É TRAÇADO: um `<rect>` com `pathLength` indo de 0 a 1, que é a
// técnica da documentação de SVG do motion. A linha nasce num canto e corre
// pelo perímetro. É a mesma ideia do "draw" de ícone, aplicada a uma moldura.
//
// ⚠️ `pathLength` NORMALIZA O PERÍMETRO para 1, e é isso que torna o efeito
// possível sem medir o cartão: sem ele, `strokeDasharray` precisaria do
// comprimento real em pixels, que muda com a largura da coluna.
//
// ⚠️ `vectorEffect="non-scaling-stroke"` porque o SVG estica junto com o
// cartão (`preserveAspectRatio="none"`): sem ele, a espessura da linha
// esticaria também, e ficaria mais grossa na horizontal que na vertical.
//
// ⚠️ `aria-hidden` e `pointer-events: none`: é decoração pura, e um SVG por
// cima do cartão roubaria o clique.

import { motion } from "motion/react";

export default function AnimatedOutline({
  show,
  radius = 8,
}: {
  show: boolean;
  /** Acompanha o `rounded-*` do cartão. */
  radius?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <motion.rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx={radius}
        ry={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        initial={false}
        animate={{ pathLength: show ? 1 : 0, opacity: show ? 1 : 0 }}
        transition={{
          // ⚠️ A LINHA CORRE, e a opacidade só acompanha: com `duration`
          // iguais o traço apareceria e sumiria por transparência, que é
          // exatamente o efeito seco que ele veio substituir.
          pathLength: { type: "spring", duration: 0.45, bounce: 0 },
          opacity: { duration: show ? 0.05 : 0.2 },
        }}
      />
    </svg>
  );
}
