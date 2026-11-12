"use client";
// Gaveta lateral da direita: fundo, painel que desliza, cabecalho com titulo e X, corpo que rola.
// O fundo e irmao do painel, nao pai: apertar dentro e soltar fora nao fecha.

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

export default function Gaveta({
  ariaLabel,
  titulo,
  subtitulo,
  onClose,
  podeFechar = true,
  motivoParaNaoFechar,
  children,
}: {
  ariaLabel: string;
  titulo: ReactNode;
  subtitulo: ReactNode;
  onClose: () => void;
  /** `false` trava o X, o Esc e o fundo (ex.: senha provisoria na tela). */
  podeFechar?: boolean;
  /** A dica do X travado. */
  motivoParaNaoFechar?: string;
  children: ReactNode;
}) {
  return (
    <>
      {/* Escurece pouco: a tabela atras e o contexto do que se edita. */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && podeFechar) onClose();
        }}
      />
      <motion.aside
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ type: "spring", duration: 0.28, bounce: 0 }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (e.key === "Escape" && podeFechar) onClose();
        }}
      >
        {/* `items-center`: o X acompanha o par titulo + subtitulo. */}
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{titulo}</h2>
            <div className="muted truncate text-xs">{subtitulo}</div>
          </div>
          <button
            className="btn btn-ghost"
            aria-label="Fechar"
            disabled={!podeFechar}
            title={podeFechar ? undefined : motivoParaNaoFechar}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </motion.aside>
    </>
  );
}
