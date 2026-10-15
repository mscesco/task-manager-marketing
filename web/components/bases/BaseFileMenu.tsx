"use client";
// components/bases/BaseFileMenu.tsx
// O menu "Planilha" da Base (Spec 057, 15/10): exportar em Excel ou CSV, e
// importar. Fica ao lado do desfazer, com os outros controles da visão.
//
// ⚠️ Exporta O QUE A VISÃO MOSTRA: as linhas filtradas e ordenadas e as
// colunas visíveis, na ordem da tela -- quem chama passa as duas listas.

import { useCallback, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import { exportBase, type ApiError } from "@/lib/api";

export default function BaseFileMenu({
  baseId,
  rowIds,
  columnIds,
  canImport,
  onImport,
}: {
  baseId: string;
  rowIds: string[];
  columnIds: string[];
  canImport: boolean;
  onImport: () => void;
}) {
  const avisar = useAvisar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useAnchoredPanel<HTMLButtonElement>(open, () => close(), { larguraPainel: 220 });
  const anchor = panel.anchorRef;
  const close = useCallback(() => {
    setOpen(false);
    anchor.current?.focus();
  }, [anchor]);

  async function doExport(format: "xlsx" | "csv") {
    close();
    setBusy(true);
    try {
      await exportBase(baseId, format, rowIds, columnIds);
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui exportar.");
    } finally {
      setBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-md hover:bg-surface-2";
  return (
    <>
      <button
        ref={panel.anchorRef}
        type="button"
        className="btn btn-ghost"
        style={{ padding: "4px 6px" }}
        aria-label="Planilha: exportar ou importar"
        title="Exportar ou importar planilha"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={busy}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <FileSpreadsheet size={14} aria-hidden="true" />
      </button>
      {open && panel.box && (
        <AnchoredPanel box={panel.box} panelRef={panel.panelRef} role="dialog" aria-label="Planilha" minWidth={220}>
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border p-0">
            <li>
              <button type="button" className={item} onClick={() => void doExport("xlsx")}>
                Exportar Excel (.xlsx)
              </button>
            </li>
            <li className="border-t border-border">
              <button type="button" className={item} onClick={() => void doExport("csv")}>
                Exportar CSV
              </button>
            </li>
            {canImport && (
              <li className="border-t border-border">
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    close();
                    onImport();
                  }}
                >
                  Importar planilha…
                </button>
              </li>
            )}
          </ul>
        </AnchoredPanel>
      )}
    </>
  );
}
