"use client";

import { useCallback, useState } from "react";
import { Archive, ArchiveRestore, Copy, FolderInput, MoreHorizontal, Trash2 } from "lucide-react";

import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";

/**
 * O "⋯" do cabecalho do detalhe (pedido dela, 05/11): Mover, Duplicar,
 * Arquivar e Excluir, que eram uma fileira de botoes no rodape.
 *
 * Quem decide se cada item aparece e o `TaskDetail` (permissao, arquivada);
 * aqui `undefined` = o item nao existe. Excluir fica por ultimo, separado e em
 * `--danger` (web/AGENTS.md §6).
 */
export default function MenuDaTarefa({
  arquivada,
  arquivando,
  onMover,
  onDuplicar,
  onAlternarArquivo,
  onExcluir,
}: {
  arquivada: boolean;
  arquivando: boolean;
  onMover?: () => void;
  onDuplicar?: () => void;
  onAlternarArquivo: () => void;
  onExcluir?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painel = useAnchoredPanel<HTMLButtonElement>(aberto, () => fechar(), {
    larguraPainel: 200,
    alinhar: "direita",
  });
  const gatilho = painel.anchorRef;
  const fechar = useCallback(() => {
    setAberto(false);
    gatilho.current?.focus();
  }, [gatilho]);

  const escolher = (acao: () => void) => () => {
    fechar();
    acao();
  };

  const itens = [
    onMover && { rotulo: "Mover…", Icone: FolderInput, acao: onMover },
    onDuplicar && { rotulo: "Duplicar", Icone: Copy, acao: onDuplicar },
    {
      rotulo: arquivando ? "…" : arquivada ? "Desarquivar" : "Arquivar",
      Icone: arquivada ? ArchiveRestore : Archive,
      acao: onAlternarArquivo,
    },
  ].filter(Boolean) as { rotulo: string; Icone: typeof Copy; acao: () => void }[];

  const classeDoItem =
    "flex w-full items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-md hover:bg-surface-2 disabled:opacity-60";

  return (
    <>
      <button
        ref={painel.anchorRef}
        type="button"
        className="btn btn-ghost"
        style={{ padding: "4px 8px", flexShrink: 0 }}
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => (aberto ? fechar() : setAberto(true))}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden />
      </button>
      {aberto && painel.box && (
        <AnchoredPanel
          box={painel.box}
          panelRef={painel.panelRef}
          role="menu"
          aria-label="Ações da tarefa"
          minWidth={200}
        >
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border p-0">
            {itens.map(({ rotulo, Icone, acao }) => (
              <li key={rotulo}>
                <button
                  type="button"
                  role="menuitem"
                  className={classeDoItem}
                  disabled={arquivando}
                  onClick={escolher(acao)}
                >
                  <Icone size={15} className="text-ink-faint" aria-hidden />
                  {rotulo}
                </button>
              </li>
            ))}
            {onExcluir && (
              <li className="border-t border-border">
                <button
                  type="button"
                  role="menuitem"
                  className={`${classeDoItem} text-danger`}
                  onClick={escolher(onExcluir)}
                >
                  <Trash2 size={15} aria-hidden />
                  Excluir
                </button>
              </li>
            )}
          </ul>
        </AnchoredPanel>
      )}
    </>
  );
}
