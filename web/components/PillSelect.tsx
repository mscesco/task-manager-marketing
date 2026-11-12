"use client";
// Seletor de permissão em pílula, com a forma do seletor de coluna do detalhe.
// Escolher não grava: só devolve a escolha, e quem chama decide se propõe ou
// aplica. O painel é o `AnchoredPanel` (`fixed`, porque as gavetas rolam).

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import Badge from "@/components/Badge";
import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";

export type PillOption<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Manda na árvore inteira (a bolinha cheia); espelha `COMMAND_ROLES` do backend. */
  readonly commands?: boolean;
};

export default function PillSelect<T extends string>({
  value,
  options,
  disabled = false,
  label,
  onSelect,
}: {
  value: T;
  options: readonly PillOption<T>[];
  disabled?: boolean;
  /** Vai no `aria-label`; precisa nomear o time, senão há vários iguais. */
  label: string;
  onSelect: (id: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fechar = useCallback(() => setIsOpen(false), []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    isOpen,
    fechar,
  );

  const atual = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        // `pill-target`: o anel de foco segue o raio do elemento que o recebe.
        className="tappable pill-target"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
        title={disabled ? undefined : "Mudar"}
        onClick={() => setIsOpen((v) => !v)}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Badge tone="soft" size="sm" color="var(--accent)">
          {atual?.label ?? "—"}
        </Badge>
      </button>

      {/* `AnimatePresence` permite a saída animada (`exit`). */}
      <AnimatePresence>
        {isOpen && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            aria-label={label}
            minWidth={200}
          >
            {/* Ordem da lista recebida (do papel mais alto ao mais baixo), não alfabética. */}
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
                    className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                      selecionada
                        ? "bg-accent-soft font-semibold text-accent"
                        : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        flexShrink: 0,
                        border: "1.5px solid var(--accent)",
                        background: o.commands ? "var(--accent)" : "transparent",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
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
