"use client";
// components/AbasEmPilula.tsx
// Abas em pílula, com a pílula branca que DESLIZA entre elas (redesign, fatia 7).
//
// ⚠️ É a mesma forma das abas da fila de solicitações (15/10), que a Camila
// aprovou; nasce como componente para a tela de notificações não copiar o
// bloco. As abas sublinhadas (`Tabs.tsx`) continuam onde a lista é o assunto e
// a aba só recorta -- a tela de Time ficou assim de propósito.

import { motion } from "motion/react";
import { DUR } from "@/lib/motion";

export type AbaEmPilula<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** `undefined` esconde; `0` MOSTRA "0". */
  readonly count?: number;
};

export default function AbasEmPilula<T extends string>({
  abas,
  ativa,
  onSelect,
  group = "pilula",
  "aria-label": ariaLabel,
}: {
  abas: readonly AbaEmPilula<T>[];
  ativa: T;
  onSelect: (id: T) => void;
  /** Distingue a pílula quando há dois grupos na mesma tela. */
  group?: string;
  "aria-label": string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-0.5 overflow-x-auto rounded-full border border-border bg-surface-2 p-1"
    >
      {abas.map((a) => {
        const on = a.id === ativa;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(a.id)}
            className={`relative cursor-pointer whitespace-nowrap rounded-full border-0 bg-transparent px-3 py-1.5 text-[12.5px] transition-colors duration-150 ${
              on ? "font-semibold text-ink" : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            {on && (
              <motion.span
                layoutId={`${group}-pilula-ativa`}
                transition={{ type: "spring", duration: DUR[3], bounce: 0.12 }}
                className="absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-card)]"
              />
            )}
            <span className="relative">
              {a.label}
              {a.count !== undefined && (
                <span className={`ml-1.5 inline-block font-semibold ${on ? "text-accent" : ""}`}>
                  {a.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
