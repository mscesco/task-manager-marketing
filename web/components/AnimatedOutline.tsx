"use client";
// components/AnimatedOutline.tsx
// O contorno que se DESENHA — Spec 047, revisão de 10/09.
//
// ⚠️⚠️ ELE SUBSTITUI O `outline` DO CSS nos cartões: *"esse contorno é bem
// feio (…) use essa svg animation pra contorno?"*. O `outline: 1px solid` do
// `.tappable:hover` aparece inteiro de uma vez, encostado no conteúdo, e não
// acompanha o raio do cartão — por isso lê como erro de borda.
//
// ⚠️⚠️ ELE MEDE O CARTÃO, e a primeira versão NÃO media: usava
// `viewBox="0 0 100 100"` com `preserveAspectRatio="none"`, contando com o SVG
// esticar. Só que esticar um quadrado de 100×100 para 350×80 esmaga os cantos
// arredondados em elipses — foi o *"ficou torta"* que ela viu. Com o `viewBox`
// no tamanho real em pixels, canto é canto.
//
// ⚠️⚠️ UMA LINHA SÓ, DO CENTRO DE BAIXO AO CENTRO DE BAIXO, também a pedido:
// *"poderia ser uma linha só que contorna o card e para na parte do contorno
// de baixo central"*. Por isso é um `<path>` e não um `<rect>`: `rect` começa
// a desenhar no canto superior esquerdo e não há como escolher, enquanto o
// `path` diz onde o traço nasce. Ele desce ao meio da base, corre a volta
// inteira e volta ao mesmo ponto.
//
// ⚠️ `pathLength` NORMALIZA O PERÍMETRO para 1, e é isso que torna o efeito
// possível sem calcular comprimento: sem ele, `strokeDasharray` precisaria do
// perímetro em pixels, que muda com a largura da coluna.
//
// ⚠️ `aria-hidden` e `pointer-events: none`: é decoração pura, e um SVG por
// cima do cartão roubaria o clique.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * O caminho da volta, começando e terminando no MEIO DA BASE.
 *
 * ⚠️ Sentido anti-horário (para a esquerda primeiro) por nenhuma razão além
 * de escolher um: o que importa é que o começo e o fim coincidam no ponto que
 * ela pediu.
 */
function volta(w: number, h: number, r: number): string {
  const raio = Math.min(r, w / 2, h / 2);
  return [
    `M ${w / 2} ${h}`,
    `L ${raio} ${h}`,
    `A ${raio} ${raio} 0 0 1 0 ${h - raio}`,
    `L 0 ${raio}`,
    `A ${raio} ${raio} 0 0 1 ${raio} 0`,
    `L ${w - raio} 0`,
    `A ${raio} ${raio} 0 0 1 ${w} ${raio}`,
    `L ${w} ${h - raio}`,
    `A ${raio} ${raio} 0 0 1 ${w - raio} ${h}`,
    `Z`,
  ].join(" ");
}

export default function AnimatedOutline({
  show,
  radius = 8,
}: {
  show: boolean;
  /** Acompanha o `rounded-*` do cartão. */
  radius?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null);

  // ⚠️ `ResizeObserver` e não uma medida única: o cartão muda de largura com a
  // coluna da grade (e com o zoom do navegador). Medido uma vez só, o traço
  // ficaria do tamanho antigo depois do primeiro redimensionamento.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () =>
      setTamanho({ w: el.offsetWidth, h: el.offsetHeight });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      {tamanho && tamanho.w > 0 && (
        <svg
          className="absolute inset-0"
          width={tamanho.w}
          height={tamanho.h}
          viewBox={`0 0 ${tamanho.w} ${tamanho.h}`}
        >
          <motion.path
            d={volta(tamanho.w, tamanho.h, radius)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: show ? 1 : 0, opacity: show ? 1 : 0 }}
            transition={{
              // ⚠️ QUASE UM SEGUNDO, e a primeira versão levava 0,45s -- *"e
              // extremamente rápida"*. Um traço que corre um perímetro inteiro
              // precisa de tempo para se ler como traço; rápido demais, ele
              // vira um piscar.
              // ⚠️ `ease` e não mola: mola desacelera no fim e o último trecho
              // do contorno rasteja.
              pathLength: { duration: 0.85, ease: "easeInOut" },
              // A opacidade só acompanha -- se ela durasse o mesmo, o traço
              // apareceria por transparência em vez de correr.
              opacity: { duration: show ? 0.05 : 0.25 },
            }}
          />
        </svg>
      )}
    </div>
  );
}
