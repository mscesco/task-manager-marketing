"use client";
// Seletor de lista com menu próprio no lugar do `<select>` nativo: cabe uma dica
// por linha ("time", "3 pessoas"). O painel é o `AnchoredPanel`.

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR } from "@/lib/motion";
import { Check, ChevronDown } from "lucide-react";
import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";

export type MenuOption<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Texto apagado à direita. */
  readonly hint?: string;
};

export default function MenuSelect<T extends string>({
  value,
  options,
  placeholder,
  disabled = false,
  "aria-label": ariaLabel,
  onSelect,
}: {
  value: T | null;
  options: readonly MenuOption<T>[];
  placeholder: string;
  disabled?: boolean;
  "aria-label": string;
  onSelect: (id: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fechar = useCallback(() => setIsOpen(false), []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    isOpen,
    fechar,
  );

  const atual = options.find((o) => o.id === value) ?? null;

  return (
    <>
      {/* `.input` no gatilho: ocupa o lugar de um campo de formulário. */}
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        className="input flex w-full items-center gap-2 text-left text-sm"
      >
        <span className={`min-w-0 flex-1 truncate ${atual ? "" : "muted"}`}>
          {atual ? atual.label : placeholder}
        </span>
        {atual?.hint && (
          <span className="muted shrink-0 text-xs">{atual.hint}</span>
        )}
        <motion.span
          className="inline-flex shrink-0"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: "spring", duration: DUR[3], bounce: 0 }}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </motion.span>
      </button>

      <AnimatePresence>
        {isOpen && box && (
          <AnchoredPanel box={box} panelRef={panelRef} aria-label={ariaLabel}>
            {options.length === 0 && (
              <div className="muted px-2 py-2 text-xs">Nada para escolher.</div>
            )}
            {options.map((o) => {
              const selecionada = o.id === value;
              return (
                <motion.div key={o.id} variants={PANEL_ITEM}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selecionada}
                    onClick={() => {
                      setIsOpen(false);
                      onSelect(o.id);
                    }}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium ${
                      selecionada
                        ? "bg-accent-soft text-accent"
                        : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="muted shrink-0 text-xs">{o.hint}</span>
                    )}
                    {selecionada && (
                      <Check size={14} aria-hidden="true" className="shrink-0" />
                    )}
                  </button>
                </motion.div>
              );
            })}
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </>
  );
}
