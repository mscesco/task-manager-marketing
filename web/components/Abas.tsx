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

export default function Abas<T extends string>({
  abas,
  ativa,
  onEscolher,
  /** Distingue os indicadores quando há dois grupos de abas na mesma tela. */
  grupo = "abas",
  "aria-label": ariaLabel,
}: {
  abas: readonly Aba<T>[];
  ativa: T;
  onEscolher: (id: T) => void;
  grupo?: string;
  "aria-label": string;
}) {
  return (
    // ⚠️ `role="tablist"` + `aria-selected` nos botões: sem isso o leitor de
    // tela anuncia "botão", e a pessoa não sabe que está num grupo nem em
    // qual item está.
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1">
      {abas.map((aba) => {
        const selecionada = aba.id === ativa;
        return (
          <button
            key={aba.id}
            role="tab"
            aria-selected={selecionada}
            className="tappable relative rounded px-3 py-1.5 text-sm"
            onClick={() => onEscolher(aba.id)}
          >
            {/* ⚠️ O INDICADOR FICA ATRÁS DO TEXTO (`-z-10`) e é irmão dele,
                não pai: envolvendo o texto, cada troca remontaria o rótulo e
                o motion animaria a caixa junto com o conteúdo, o que faz o
                texto "pular". */}
            {selecionada && (
              <motion.span
                layoutId={`${grupo}-indicador`}
                className="absolute inset-0 -z-10 rounded bg-surface-2"
                // Curta de propósito, no mesmo espírito dos 150ms do modal:
                // o suficiente para tirar o corte seco, curto o bastante para
                // não atrasar quem usa o app o dia inteiro.
                transition={{ type: "spring", duration: 0.25, bounce: 0.15 }}
              />
            )}
            <span className={selecionada ? "font-semibold" : "muted"}>
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
