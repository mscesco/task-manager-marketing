"use client";
// components/Abas.tsx
// Abas com indicador que DESLIZA entre elas — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ O `layoutId` DO MOTION É O TRUQUE INTEIRO, e é por ele que a
// dependência entrou. Com CSS puro dá para animar um sublinhado, mas ele
// precisa de largura fixa: o indicador não sabe medir a aba de destino. Com
// `layoutId`, duas instâncias do mesmo id em lugares diferentes viram UM
// elemento que o motion interpola — ele mede a origem e o destino sozinho, e
// as abas podem ter larguras diferentes ("Ativos" e "Convidados" têm).
//
// ⚠️⚠️ DUAS VARIANTES, e a diferença NÃO é enfeite: elas dizem coisas
// diferentes.
//
//     pilula       -> um ALTERNADOR: escolher A ou B, dois estados do mesmo
//                     peso. Precisa de moldura, senão são palavras soltas na
//                     tela -- foi exatamente o que a Camila apontou em 09/09.
//     sublinhado   -> ABAS de verdade: recortes de uma mesma lista, onde a
//                     lista continua sendo o assunto e a aba é só o filtro.
//
// A moldura do alternador é o que o distingue das abas logo abaixo dele; se
// os dois tivessem a mesma forma, a tela teria duas fileiras de palavras e
// nenhuma pista de que uma troca o ASSUNTO e a outra só recorta.
//
// ⚠️ `prefers-reduced-motion` JÁ É HONRADO por um bloco global do
// `globals.css` (`* { animation: none !important }`), e o `motion` respeita a
// mesma media query por conta própria. Quem pede menos movimento vê a troca
// seca, sem nada a mais aqui.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest (§7 da spec).

import { motion } from "motion/react";

export type Aba<T extends string> = {
  readonly id: T;
  readonly rotulo: string;
  /** Número ao lado. ⚠️ `undefined` esconde; `0` MOSTRA "0". */
  readonly contagem?: number;
};

/** Ver o bloco no topo: a forma diz se a troca muda o assunto ou só recorta. */
export type VarianteDeAbas = "pilula" | "sublinhado";

// Curtas de propósito, no mesmo espírito dos 150ms do modal: o suficiente
// para tirar o corte seco, curto o bastante para não atrasar quem usa o app o
// dia inteiro.
const MOLA = { type: "spring", duration: 0.3, bounce: 0.18 } as const;

export default function Abas<T extends string>({
  abas,
  ativa,
  onEscolher,
  variante = "sublinhado",
  /** Distingue os indicadores quando há dois grupos de abas na mesma tela. */
  grupo = "abas",
  "aria-label": ariaLabel,
}: {
  abas: readonly Aba<T>[];
  ativa: T;
  onEscolher: (id: T) => void;
  variante?: VarianteDeAbas;
  grupo?: string;
  "aria-label": string;
}) {
  const ehPilula = variante === "pilula";

  return (
    // ⚠️ `role="tablist"` + `aria-selected` nos botões: sem isso o leitor de
    // tela anuncia "botão", e a pessoa não sabe que está num grupo nem em
    // qual item está.
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        ehPilula
          ? // A MOLDURA do alternador: fundo rebaixado, borda e um respiro de
            // 1 unidade, que é o espaço em que a pílula branca desliza.
            "inline-flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
          : // As abas se apoiam numa régua; o indicador nasce sobre ela.
            "flex gap-1 border-b border-border"
      }
    >
      {abas.map((aba) => {
        const selecionada = aba.id === ativa;
        return (
          <button
            key={aba.id}
            role="tab"
            aria-selected={selecionada}
            className={
              ehPilula
                ? "tappable relative rounded-md px-3 py-1.5 text-sm"
                : "tappable relative rounded-t px-3 pb-2 pt-1.5 text-sm"
            }
            onClick={() => onEscolher(aba.id)}
          >
            {/* ⚠️ O INDICADOR FICA ATRÁS DO TEXTO (`-z-10`) e é irmão dele,
                não pai: envolvendo o texto, cada troca remontaria o rótulo e
                o motion animaria a caixa junto com o conteúdo, o que faz o
                texto "pular". */}
            {selecionada &&
              (ehPilula ? (
                <motion.span
                  layoutId={`${grupo}-indicador`}
                  className="absolute inset-0 -z-10 rounded-md bg-surface"
                  style={{ boxShadow: "var(--shadow)" }}
                  transition={MOLA}
                />
              ) : (
                // ⚠️ `-bottom-px` põe a barra EM CIMA da régua do `border-b`,
                // e não abaixo dela: um pixel de folga faria o sublinhado
                // parecer solto, e a régua continuaria visível por baixo.
                <motion.span
                  layoutId={`${grupo}-indicador`}
                  className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent"
                  transition={MOLA}
                />
              ))}
            <span
              className={
                selecionada
                  ? ehPilula
                    ? "font-semibold"
                    : "font-semibold text-accent"
                  : "muted"
              }
            >
              {aba.rotulo}
            </span>
            {aba.contagem !== undefined && (
              <span className="muted ml-1.5 text-xs">{aba.contagem}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
