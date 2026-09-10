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

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
// ⚠️ A GEOMETRIA MORA EM `lib/`, e nao aqui: em jsdom nao ha layout, o
// `<svg>` nunca monta, e nenhum teste de componente alcanca o caminho. Foi
// por isso que o traco cortado no canto chegou a tela sem ninguem ver.
import { caminhoDaVolta, ESPESSURA } from "@/lib/contorno";

/** Quanto do perímetro o traço ocupa. Ver o bloco no topo. */
const TAMANHO_DO_TRACO = 0.22;

/**
 * O raio REAL da superfície, lido do CSS dela.
 *
 * ⚠️⚠️ ELE SUBSTITUI O PALPITE DO CHAMADOR, e o palpite estava errado em três
 * lugares de uma vez. `rounded-lg` NESTE projeto é **12px**, e não os 8 do
 * Tailwind padrão: o `@theme` do `globals.css` define `--radius-lg: 12px`, e o
 * Tailwind v4 gera as utilitárias a partir dali. Eu passei 8 no cartão de
 * área, no cartão de subtime e no cartão de solicitação -- três contornos
 * curvando menos que a borda que eles acompanham.
 *
 * ⚠️ E o erro não tinha como aparecer num teste: em jsdom não há layout, e o
 * número certo mora numa variável CSS que nenhum `.tsx` importa. Perguntar ao
 * elemento é o que fecha essa porta -- inclusive para quem mudar o token
 * depois.
 */
function raioDoPai(el: Element): number | null {
  const pai = el.parentElement;
  if (!pai) return null;
  // ⚠️ `getComputedStyle` devolve "" em jsdom e "0px" quando não há raio; os
  // dois viram `null`/0 sem estourar.
  const bruto = getComputedStyle(pai).borderTopLeftRadius;
  // ⚠️ Porcentagem existe em CSS e `parseFloat` a leria como pixels ("50%" ->
  // 50). Nenhuma superfície daqui usa, e adivinhar seria pior que desistir.
  if (!bruto || bruto.includes("%")) return null;
  const n = Number.parseFloat(bruto);
  return Number.isFinite(n) ? n : null;
}

export default function AnimatedOutline({
  show,
  radius,
}: {
  show: boolean;
  /**
   * Raio, em pixels — **reserva**. O normal é NÃO passar: o contorno lê o raio
   * do CSS da superfície (`raioDoPai`). Só serve para o caso em que ler falhe
   * (raio em porcentagem, ou ambiente sem layout).
   */
  radius?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [medida, setMedida] = useState<{
    w: number;
    h: number;
    r: number;
  } | null>(null);

  // ⚠️ `ResizeObserver` e não uma medida única: o cartão muda de largura com a
  // coluna da grade (e com o zoom do navegador). Medido uma vez só, o traço
  // ficaria do tamanho antigo depois do primeiro redimensionamento.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ⚠️ O RAIO É MEDIDO JUNTO, e no mesmo `medir`: ele não muda com o
    // tamanho, mas muda com o TEMA e com qualquer troca do token -- e reler
    // aqui custa nada, enquanto uma leitura única na montagem envelheceria.
    const medir = () =>
      setMedida({
        w: el.offsetWidth,
        h: el.offsetHeight,
        r: raioDoPai(el) ?? radius ?? 0,
      });
    medir();
    // ⚠️⚠️ A GUARDA NÃO É PARANOIA COM NAVEGADOR VELHO -- é o jsdom. Enquanto
    // o contorno vivia só no cartão de subtime (que não tinha teste), ninguém
    // o renderizava sob teste. Ao virar o contorno de sete superfícies, ele
    // passou a montar dentro de meia suíte e derrubou 45 testes de uma vez com
    // `ReferenceError: ResizeObserver is not defined`.
    //
    // ⚠️ E a saída foi a GUARDA, e não um `ResizeObserver` falso no
    // `setupFiles`: o falso faria os testes passarem com o componente ainda
    // exigindo uma API que pode não existir. Sem observador, a medida única de
    // cima já valeu -- o que se perde é acompanhar o redimensionamento, e em
    // jsdom não há redimensionamento nenhum.
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
    // ⚠️ `radius` na lista porque ele entra na medida. Ele é constante em todo
    // chamador de hoje, mas depender de um valor sem o declarar é como o
    // `wrapRef` que nunca foi pendurado -- funciona até não funcionar.
  }, [radius]);

  return (
    // ⚠️⚠️ `<span>` E NÃO `<div>`, desde 10/09: o contorno passou a viver
    // dentro de `<button>` também (as superfícies clicáveis que não são link),
    // e `<div>` dentro de `<button>` é HTML inválido — o navegador pode desfazer
    // o aninhamento por conta própria, exatamente como faria com `<button>`
    // dentro de `<a>`. `<span>` é conteúdo de frase, e com `display:block` (o
    // `block` da classe) mede igual.
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 block"
    >
      {medida && medida.w > 0 && (
        <svg
          className="absolute inset-0"
          width={medida.w}
          height={medida.h}
          viewBox={`0 0 ${medida.w} ${medida.h}`}
        >
          <motion.path
            d={caminhoDaVolta(medida.w, medida.h, medida.r)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={ESPESSURA}
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
    </span>
  );
}

/**
 * O contorno desenhado, pronto para pendurar em qualquer superfície clicável.
 *
 * ⚠️⚠️ ELE EXISTE PORQUE O CONTORNO DEIXOU DE SER DO CARTÃO DE SUBTIME e passou
 * a ser O contorno do produto. Pedido da Camila em 10/09, depois de ver o anel
 * duro do CSS na grade de áreas: *"dá para identificar e mudar absolutamente
 * todos para ficar com a animação igual dos subtimes? do jeito que está não tem
 * como ficar, sério mesmo"*.
 *
 * ⚠️⚠️ É UM GANCHO, e não um componente que embrulha. As superfícies clicáveis
 * do produto são `<a>`, `<button>` e `<div role="button">`, cada uma com seus
 * atributos e seu `style` inline; um componente polimórfico teria de repassar
 * tudo isso e ainda escolher a tag. O gancho devolve as três peças e deixa a
 * tag onde ela está:
 *
 *     const { alvo, outline } = useDrawnOutline();
 *     <a {...alvo} className="relative …">{outline}…</a>
 *
 * ⚠️ `relative` FICA NO CHAMADOR, de propósito: o contorno é `absolute
 * inset-0`, e sem contexto de posicionamento ele mediria o ancestral posicionado
 * mais próximo -- desenhando a volta do cartão errado. Deixar a classe visível
 * na tela é o que faz a dependência aparecer na leitura.
 *
 * ⚠️ HOVER **E** FOCO acendem: são os dois modos de dizer "este é o alvo", e
 * atender só o mouse deixa o teclado sem destaque -- que é justamente o que o
 * `:focus-visible` do CSS fazia por todo mundo antes.
 *
 * ⚠️⚠️ NÃO PASSE `radius`. Ele existe como reserva; o raio real é LIDO do CSS
 * da superfície. A primeira versão pedia o número ao chamador e eu errei em
 * três de sete -- `rounded-lg` aqui é 12px (o `@theme` do `globals.css`
 * redefine `--radius-lg`), e não os 8 do Tailwind padrão. Foi o *"não pegando
 * muito bem os arredondados"* de 10/09.
 */
export function useDrawnOutline(radius?: number) {
  const [aceso, setAceso] = useState(false);
  const alvo = useMemo(
    () => ({
      onMouseEnter: () => setAceso(true),
      onMouseLeave: () => setAceso(false),
      onFocus: () => setAceso(true),
      onBlur: () => setAceso(false),
    }),
    [],
  );
  return {
    alvo,
    outline: <AnimatedOutline show={aceso} radius={radius} />,
  };
}
