"use client";
// A moldura dos diálogos centrados: o fundo escurecido e a caixa.
// - `onEsc`: Esc fecha. Quem está ocupado passa `undefined`.
// - `onFundo`: clicar no fundo fecha. Diálogos destrutivos não passam.
//   Só conta o `mousedown` no próprio fundo: apertar dentro e soltar fora
//   (selecionando texto) não fecha.

import type { ReactNode, Ref } from "react";

export default function CaixaDeDialogo({
  ariaLabel,
  largura,
  caixaRef,
  onEsc,
  onFundo,
  respiroNoTopo = "8vh",
  acimaDeModal = true,
  isolarCliques = false,
  children,
}: {
  ariaLabel: string;
  /** Largura da caixa em px (encolhe na tela estreita). */
  largura: number;
  caixaRef?: Ref<HTMLDivElement>;
  onEsc?: () => void;
  onFundo?: () => void;
  respiroNoTopo?: "8vh" | "12vh";
  /** `z-60`: abre por cima de outro modal (o detalhe da tarefa). Senao `z-50`. */
  acimaDeModal?: boolean;
  /** O `mousedown` dentro da caixa não chega ao documento: sem isto, abrir de
   *  dentro de um painel que fecha ao clicar fora fecharia esse painel. */
  isolarCliques?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`modal-scrim fixed inset-0 flex items-start justify-center bg-[rgba(16,24,40,0.45)] px-4 pb-6 ${
        respiroNoTopo === "12vh" ? "pt-[12vh]" : "pt-[8vh]"
      } ${acimaDeModal ? "z-[60]" : "z-50"}`}
      onMouseDown={(e) => {
        if (onFundo && e.target === e.currentTarget) onFundo();
      }}
    >
      <div
        ref={caixaRef}
        className="modal-card max-h-[84dvh] max-w-full overflow-y-auto rounded-[14px] border border-border bg-surface p-5 shadow-[var(--shadow)]"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onMouseDown={isolarCliques ? (e) => e.stopPropagation() : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onEsc) {
            e.stopPropagation();
            onEsc();
          }
        }}
        // A largura é o único valor de runtime, por isso inline.
        style={{ width: largura }}
      >
        {children}
      </div>
    </div>
  );
}
