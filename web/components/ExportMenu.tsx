"use client";
// components/ExportMenu.tsx
// "Exportar" da tela inicial (Spec 058, 15/10): PDF e planilha.
//
// - PDF é a IMPRESSÃO do navegador ("Salvar como PDF"): a tela já está no
//   formato certo, e o `@media print` do `globals.css` tira a barra lateral,
//   força o tema claro e mantém as cores. Nada a gerar no servidor.
// - A planilha vem do servidor (`GET /dashboard/export`), com os MESMOS
//   filtros da tela.

import { useCallback, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import type { ApiError } from "@/lib/api";

export default function ExportMenu({ onSpreadsheet }: { onSpreadsheet: () => Promise<void> }) {
  const avisar = useAvisar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useAnchoredPanel<HTMLButtonElement>(open, () => close(), { larguraPainel: 240 });
  const anchor = panel.anchorRef;
  const close = useCallback(() => {
    setOpen(false);
    anchor.current?.focus();
  }, [anchor]);

  async function spreadsheet() {
    close();
    setBusy(true);
    try {
      await onSpreadsheet();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui gerar a planilha.");
    } finally {
      setBusy(false);
    }
  }

  function pdf() {
    close();
    // ⚠️ Depois de fechar: o painel aberto sairia no PDF.
    window.setTimeout(() => window.print(), 50);
  }

  return (
    <>
      <button
        ref={panel.anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-base font-semibold transition-[border-color] duration-150 hover:border-accent disabled:opacity-60"
      >
        <Download size={14} className="text-ink-faint" aria-hidden="true" />
        {busy ? "Gerando…" : "Exportar"}
        <ChevronDown size={14} className="text-ink-faint" aria-hidden="true" />
      </button>
      {open && panel.box && (
        <AnchoredPanel box={panel.box} panelRef={panel.panelRef} role="dialog" aria-label="Exportar" minWidth={240}>
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border p-0">
            <li>
              <button
                type="button"
                onClick={pdf}
                className="flex w-full items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-md hover:bg-surface-2"
              >
                <FileText size={16} className="text-ink-faint" aria-hidden="true" />
                <span className="flex flex-col">
                  PDF
                  <span className="text-xs text-ink-faint">o painel como está na tela</span>
                </span>
              </button>
            </li>
            <li className="border-t border-border">
              <button
                type="button"
                onClick={() => void spreadsheet()}
                className="flex w-full items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-md hover:bg-surface-2"
              >
                <FileSpreadsheet size={16} className="text-ink-faint" aria-hidden="true" />
                <span className="flex flex-col">
                  Planilha (Excel)
                  <span className="text-xs text-ink-faint">números e tarefas, para mexer</span>
                </span>
              </button>
            </li>
          </ul>
        </AnchoredPanel>
      )}
    </>
  );
}
