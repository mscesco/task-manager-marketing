"use client";
// Os três pontinhos que pulam, em três tamanhos (linha, bloco, tela).
// `staggerChildren` negativo com `staggerDirection: -1` faz a onda correr do último ao primeiro;
// `repeatType: "mirror"` faz o ponto descer em vez de teleportar ao chão.

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

  // O `bloco` centra também na vertical: ele é sempre "o conteúdo desta área ainda não chegou".
  // `linha` e `tela` não ganham altura (`LoadingScreen` já centra em 100vh).
  // As variantes dependem do tamanho, por isso nascem aqui dentro.
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

  const pontos = (
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
        // Altura reservada: sem ela o pulo transborda e empurra o que está acima.
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

  if (tamanho !== "bloco") return pontos;

  // `45vh` e não `100%`: o `<main>` do `AppShell` não é flex, e 100% daria a altura do conteúdo (zero).
  return (
    <div
      style={{ display: "grid", placeItems: "center", minHeight: "45vh" }}
    >
      {pontos}
    </div>
  );
}

/**
 * O esqueleto: a forma da tela que vem (colunas de cards, linhas), onde ela é óbvia.
 * Mesmo `role="status"` + `aria-label` dos pontos: os testes procuram a espera pelo nome.
 * O brilho mora na classe `.skeleton` do `globals.css`.
 */
export function Esqueleto({
  forma,
  rotulo = "Carregando",
}: {
  forma: "linhas" | "colunas";
  rotulo?: string;
}) {
  // Larguras variadas para parecer texto, e não uma régua.
  const larguras = ["w-[72%]", "w-[88%]", "w-3/5", "w-4/5", "w-2/3"];
  const linha = (i: number) => <div key={i} className={`skeleton h-4 ${larguras[i % 5]}`} />;
  return (
    <div role="status" aria-busy="true" aria-label={rotulo} className="w-full">
      {forma === "linhas" ? (
        <div aria-hidden="true" className="flex flex-col gap-3 py-2">
          {[0, 1, 2, 3, 4, 5].map(linha)}
        </div>
      ) : (
        <div aria-hidden="true" className="flex gap-3.5 overflow-hidden">
          {[0, 1, 2].map((c) => (
            <div key={c} className="flex min-w-[240px] flex-1 flex-col gap-2 p-1">
              <div className="skeleton mb-2 h-4 w-1/2" />
              {[0, 1, 2].map((k) => (
                <div key={k} className="skeleton h-20 rounded-[var(--radius-lg)]" />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
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
