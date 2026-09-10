"use client";
// components/Loading.tsx
// Os três pontinhos que pulam — Spec 047, revisão de 10/09.
//
// ⚠️⚠️ ELES SUBSTITUEM TODO "Carregando…" DO PRODUTO, a pedido da Camila, com
// o exemplo do motion na mão. Antes era texto solto, e texto de espera tem um
// problema conhecido: parado, ele não distingue "ainda estou buscando" de
// "travou". O movimento distingue.
//
// ⚠️ TRÊS TAMANHOS, e não um: o mesmo componente aparece numa TELA INTEIRA
// (checando a sessão), num BLOCO (a tabela ainda não chegou) e numa LINHA
// (dentro de uma gaveta, ao lado de um rótulo). Pontos de 20px como no exemplo
// ficariam maiores que o texto ao lado no terceiro caso.
//
// ⚠️ `staggerChildren` NEGATIVO com `staggerDirection: -1`, como no exemplo
// dela: é o que faz a onda correr do último ponto para o primeiro. Trocar o
// sinal inverte o sentido; tirar, faz os três pularem juntos — e aí não é
// onda, é pisca-pisca.
//
// ⚠️ `repeatType: "mirror"` e não `"loop"`: com `loop`, o ponto volta ao chão
// de um quadro para o outro (teleporte). Com `mirror`, ele DESCE, que é o que
// completa o pulo.
//
// ⚠️ ACESSIBILIDADE: `role="status"` + `aria-label`, porque a animação sozinha
// não diz nada a quem usa leitor de tela — e o texto que existia antes dizia.
// Os pontos ficam `aria-hidden`.
//
// ⚠️ `prefers-reduced-motion` já é honrado pelo bloco global do `globals.css`
// e pelo próprio motion: quem pede menos movimento vê três pontos parados,
// que ainda leem como "espere".
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest.

import { motion, type Variants } from "motion/react";

export type TamanhoDoLoading = "linha" | "bloco" | "tela";

/** Diâmetro do ponto e altura do pulo, por tamanho. */
const MEDIDAS: Record<TamanhoDoLoading, { ponto: number; pulo: number }> = {
  // Ao lado de um rótulo, dentro de uma gaveta.
  linha: { ponto: 6, pulo: -8 },
  // No lugar de uma tabela ou lista que ainda não chegou.
  bloco: { ponto: 10, pulo: -14 },
  // A tela inteira, antes de qualquer conteúdo existir.
  tela: { ponto: 14, pulo: -20 },
};

export default function Loading({
  tamanho = "bloco",
  /** O que se está esperando — vai para o leitor de tela. */
  rotulo = "Carregando",
}: {
  tamanho?: TamanhoDoLoading;
  rotulo?: string;
}) {
  const { ponto, pulo } = MEDIDAS[tamanho];

  // ⚠️ AS VARIANTES DEPENDEM DO TAMANHO, então nascem aqui dentro e não em
  // constante de módulo: uma constante fixaria o pulo de 30px do exemplo em
  // todos os três casos.
  const dot: Variants = {
    jump: {
      y: pulo,
      transition: {
        duration: 0.8,
        repeat: Infinity,
        repeatType: "mirror",
        ease: "easeInOut",
      },
    },
  };

  return (
    <motion.div
      role="status"
      aria-label={rotulo}
      animate="jump"
      transition={{ staggerChildren: -0.2, staggerDirection: -1 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: ponto * 0.6,
        // ⚠️ ALTURA RESERVADA: sem ela, o contêiner tem a altura do ponto e o
        // pulo transborda para cima, empurrando o que estiver acima. Com o
        // espaço reservado, nada em volta se mexe.
        minHeight: ponto - pulo + ponto,
      }}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          variants={dot}
          style={{
            width: ponto,
            height: ponto,
            borderRadius: "50%",
            background: "var(--accent)",
            display: "block",
            willChange: "transform",
          }}
        />
      ))}
    </motion.div>
  );
}

/** A tela inteira, centrada — o estado antes de qualquer conteúdo existir. */
export function LoadingScreen({ rotulo }: { rotulo?: string }) {
  return (
    <div className="center-screen">
      <Loading tamanho="tela" rotulo={rotulo} />
    </div>
  );
}
