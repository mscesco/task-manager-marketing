"use client";
// Alternador de dois lados de mesma largura (para N abas, `Tabs.tsx`).
// A pastilha é um `<motion.div layout />` em fluxo: o pai troca o `justify-content` e
// o `layout` anima o deslocamento (uma pastilha `absolute` não se moveria).
// Altura fixa porque os rótulos ficam numa camada sobreposta, fora do fluxo.

import { motion } from "motion/react";
import { DUR } from "@/lib/motion";

export type ToggleSide<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Número ao lado: `undefined` esconde; `0` mostra "0". */
  readonly count?: number;
};

export default function Toggle<T extends string>({
  sides,
  active,
  onSelect,
  "aria-label": ariaLabel,
}: {
  /** Exatamente dois. */
  sides: readonly [ToggleSide<T>, ToggleSide<T>];
  active: T;
  onSelect: (id: T) => void;
  "aria-label": string;
}) {
  const noPrimeiro = active === sides[0].id;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex h-9 w-full max-w-[320px] rounded-lg border border-border bg-surface-2 p-1"
      // Única propriedade que muda; o `layout` da pastilha anima o resto.
      style={{ justifyContent: noPrimeiro ? "flex-start" : "flex-end" }}
    >
      <motion.div
        layout
        // Curta de propósito, como os 150ms do modal.
        transition={{ type: "spring", duration: DUR[3], bounce: 0.18 }}
        className="h-full w-1/2 rounded-md bg-surface"
        style={{ boxShadow: "var(--shadow)" }}
      />

      {/* Rótulos por cima da pastilha, para o texto não pular; `inset-1` casa com o `p-1` do contêiner. */}
      <div className="absolute inset-1 flex">
        {sides.map((lado) => {
          const selecionado = lado.id === active;
          return (
            <button
              key={lado.id}
              role="tab"
              aria-selected={selecionado}
              className="tappable flex-1 rounded-md text-sm"
              onClick={() => onSelect(lado.id)}
            >
              <span className={selecionado ? "font-semibold" : "muted"}>
                {lado.label}
              </span>
              {lado.count !== undefined && (
                <span className="muted ml-1.5 text-xs">{lado.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
