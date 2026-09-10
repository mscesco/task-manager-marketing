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
// ⚠️⚠️ UM TRAÇO CURTO QUE CORRE E PARA EMBAIXO, e não a volta inteira
// desenhada. A primeira versão acendia o perímetro todo e ficava com o cartão
// contornado no fim; ela corrigiu: *"ele tá muito grande, contornando tudo, eu
// pensei em uma linha pequena que corre contornando o card e para embaixo"*.
//
// ⚠️ SÃO DUAS PROPRIEDADES DIFERENTES, e é aí que estava meu erro:
//
//     `pathLength` -- QUANTO do caminho fica visível. Fixo em 0,22: um quarto
//                     do perímetro, o "cometa".
//     `pathOffset` -- ONDE esse pedaço está. É ele que ANIMA, de 0 a 0,78.
//
// Somando, o fim do traço para exatamente em 1 -- o fim do caminho, que é o
// meio da base. Antes eu animava o `pathLength`, e animar "quanto aparece"
// é justamente desenhar a volta inteira.
//
// ⚠️ Por isso é um `<path>` e não um `<rect>`: `rect` começa no canto superior
// esquerdo e não há como escolher, enquanto o `path` diz onde o traço nasce e
// morre. As duas pontas estão no meio da base.
//
// ⚠️ As duas propriedades são NORMALIZADAS (0 a 1), e é o que torna o efeito
// possível sem calcular comprimento: em CSS puro, `strokeDasharray` precisaria
// do perímetro em pixels, que muda com a largura da coluna.
//
// ⚠️ `aria-hidden` e `pointer-events: none`: é decoração pura, e um SVG por
// cima do cartão roubaria o clique.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/** Quanto do perímetro o traço ocupa. Ver o bloco no topo. */
const TAMANHO_DO_TRACO = 0.22;

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
            // ⚠️ FIXO: é o TAMANHO do traço, não o progresso. Ver o topo.
            pathLength={TAMANHO_DO_TRACO}
            initial={false}
            animate={{
              // O traço nasce escondido antes do início e para com a ponta
              // no fim do caminho — o meio da base.
              pathOffset: show ? 1 - TAMANHO_DO_TRACO : -TAMANHO_DO_TRACO,
              opacity: show ? 1 : 0,
            }}
            transition={{
              // ⚠️ QUASE UM SEGUNDO, e a primeira versão levava 0,45s -- *"e
              // extremamente rápida"*. Um traço que corre um perímetro inteiro
              // precisa de tempo para se ler como traço; rápido demais, vira
              // um piscar.
              // ⚠️ `ease` e não mola: mola desacelera no fim, e a chegada no
              // meio da base — que é o ponto da animação — rastejaria.
              pathOffset: { duration: 0.85, ease: "easeInOut" },
              // A opacidade só acompanha; se durasse o mesmo, o traço
              // apareceria por transparência em vez de correr.
              opacity: { duration: show ? 0.05 : 0.25 },
            }}
          />
        </svg>
      )}
    </div>
  );
}
