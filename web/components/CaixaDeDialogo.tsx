"use client";
// components/CaixaDeDialogo.tsx
// A moldura dos dialogos centrados: o fundo escurecido e a caixa.
//
// ⚠️ ERAM TRES COPIAS, E TINHAM DIVERGIDO NO DESENHO (revisao de 07/10):
// `ConfirmarExclusaoDeQuadro`, `RevisaoDaEdicao` e `FormNovaColuna` montavam o
// mesmo fundo e a mesma caixa a mao, e a de apagar quadro tinha nascido sem
// borda e sem sombra, com outro raio. Uma moldura so.
//
// ⚠️ A REGRA DE FECHAR CONTINUA SENDO DE QUEM USA, e e diferente de proposito:
// - `onEsc`: Esc fecha. Quem esta ocupado (salvando) passa `undefined`.
// - `onFundo`: clicar no FUNDO fecha. Os dialogos de confirmacao destrutiva
//   (apagar quadro, revisar colunas) NAO passam -- la so o botao e o Esc
//   fecham, para um clique errado ao lado nao desfazer o que a pessoa leu.
//   ⚠️ So conta o `mousedown` no proprio fundo (`target === currentTarget`):
//   apertar dentro e soltar fora nao fecha -- selecionar texto do campo e
//   arrastar para fora jogaria fora o que se digitou.

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
  /** O `mousedown` dentro da caixa nao chega ao documento. ⚠️ Para o dialogo
   *  aberto de dentro de um painel que fecha ao "clicar fora" (o do quadro):
   *  sem isto, clicar na caixa fecharia o painel que a abriu. */
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
        className="modal-card max-h-[84vh] max-w-full overflow-y-auto rounded-[14px] border border-border bg-surface p-5 shadow-[var(--shadow)]"
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
        // A largura e o unico valor de runtime -- a excecao do estilo inline
        // (web/AGENTS.md §11).
        style={{ width: largura }}
      >
        {children}
      </div>
    </div>
  );
}
