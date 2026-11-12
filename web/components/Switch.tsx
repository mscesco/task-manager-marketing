"use client";
// Interruptor de um valor (liga/desliga). Tabs recorta uma lista; Toggle escolhe entre dois assuntos.
// `role="switch"` num botão: o clique já grava, e o nome acessível vem do `aria-label`.

import { motion } from "motion/react";
import { DUR } from "@/lib/motion";

export default function Switch({
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onChange: (proximo: boolean) => void;
  disabled?: boolean;
  "aria-label": string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="tappable inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border p-0.5 disabled:opacity-50"
      style={{
        // Só o `justify-content` muda; o `layout` da pastilha anima o resto.
        justifyContent: checked ? "flex-end" : "flex-start",
        background: checked ? "var(--accent)" : "var(--surface-2)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <motion.span
        layout
        transition={{ type: "spring", duration: DUR[2], bounce: 0.2 }}
        aria-hidden
        className="block h-4.5 w-4.5 rounded-full bg-surface"
        style={{ height: 18, width: 18, boxShadow: "var(--shadow)" }}
      />
    </button>
  );
}
