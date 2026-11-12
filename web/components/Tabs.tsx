"use client";
// Abas com indicador que desliza: recortes de uma mesma lista (escolher entre assuntos é o `Toggle.tsx`).
// O `layoutId` do motion interpola o indicador entre abas de larguras diferentes.

import { motion } from "motion/react";
import { DUR } from "@/lib/motion";

export type Tab<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Número ao lado. `undefined` esconde; `0` mostra "0". */
  readonly count?: number;
};

// Curtas: tiram o corte seco sem atrasar quem usa o app o dia inteiro.
const SPRING = { type: "spring", duration: DUR[3], bounce: 0.18 } as const;

export default function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  /** Distingue os indicadores quando há dois grupos de abas na mesma tela. */
  group = "abas",
  "aria-label": ariaLabel,
}: {
  tabs: readonly Tab<T>[];
  active: T;
  onSelect: (id: T) => void;
  group?: string;
  "aria-label": string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // As abas se apoiam numa régua; o indicador nasce sobre ela.
      className="flex gap-1 border-b border-border"
    >
      {tabs.map((aba) => {
        const selecionada = aba.id === active;
        return (
          <button
            key={aba.id}
            role="tab"
            aria-selected={selecionada}
            // Sem contorno de foco (ficava torto nos cantos); o foco vira fundo (`focus-visible:bg-surface-2`).
            className="tappable relative rounded-t px-3 pb-2 pt-1.5 text-sm outline-none focus-visible:bg-surface-2 focus-visible:outline-none"
            onClick={() => onSelect(aba.id)}
          >
            {/* Indicador irmão do texto, e não pai, para o texto não "pular".
                `-bottom-px` põe a barra em cima da régua do `border-b`. */}
            {selecionada && (
              <motion.span
                layoutId={`${group}-indicador`}
                className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent"
                transition={SPRING}
              />
            )}
            <span
              className={selecionada ? "font-semibold text-accent" : "muted"}
            >
              {aba.label}
            </span>
            {aba.count !== undefined && (
              <span className="muted ml-1.5 text-xs">{aba.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
