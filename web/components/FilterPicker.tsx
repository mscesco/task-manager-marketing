"use client";
// components/FilterPicker.tsx
// O seletor dos filtros da tela inicial (Spec 058, 14/10).
//
// ⚠️ NO PADRÃO DO SELETOR DE RESPONSÁVEIS do detalhe, e não `<select>` nativo
// (pedido dela, 14/10): botão que abre um painel com BUSCA e a lista, cada
// pessoa com o avatar dela. O painel é o `AnchoredPanel` (fecha ao clicar
// fora, no Esc e ao rolar; abre para cima quando falta espaço).
//
// ⚠️ ESCOLHA ÚNICA, com "Todos" no topo: escolher fecha o painel. O de
// responsáveis é múltiplo (caixinhas); aqui um filtro é um valor só.

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import Avatar from "@/components/Avatar";
import { normalizarBusca } from "@/lib/filtrosQuadro";

export type FilterOption = { id: string; name: string };

export default function FilterPicker({
  label,
  value,
  allLabel,
  options,
  people = false,
  onChange,
}: {
  /** O nome do filtro ("Pessoa"), também o nome acessível do botão. */
  label: string;
  value: string | null;
  /** O texto de "sem filtro" ("Todas as pessoas"). */
  allLabel: string;
  options: readonly FilterOption[];
  /** Mostra o avatar de cada opção (é uma lista de pessoas). */
  people?: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const panel = useAnchoredPanel<HTMLButtonElement>(open, () => close(), { larguraPainel: 280 });
  // ⚠️ O foco VOLTA ao botão (revisão de 15/10): a busca focada some com o
  // painel, e sem isto o teclado caía no `<body>`.
  const anchor = panel.anchorRef;
  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
    anchor.current?.focus();
  }, [anchor]);

  const current = options.find((o) => o.id === value) ?? null;
  const shown = useMemo(() => {
    const term = normalizarBusca(search);
    return term ? options.filter((o) => normalizarBusca(o.name).includes(term)) : options;
  }, [options, search]);

  function pick(id: string | null) {
    onChange(id);
    close();
  }

  return (
    <>
      <button
        ref={panel.anchorRef}
        type="button"
        aria-label={`${label}: ${current?.name ?? allLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-9 min-w-[190px] max-w-[260px] items-center gap-2 rounded-full border bg-surface px-3 text-base transition-[border-color] duration-150 hover:border-accent ${
          current ? "border-accent" : "border-border"
        }`}
      >
        <span className="text-xs text-ink-faint">{label}</span>
        {current && people ? (
          <Avatar id={current.id} name={current.name} size="sm" />
        ) : (
          !current && people && <Users size={14} className="text-ink-faint" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-left font-semibold">
          {current?.name ?? allLabel}
        </span>
        <ChevronDown size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>

      {open && panel.box && (
        <AnchoredPanel
          box={panel.box}
          panelRef={panel.panelRef}
          role="dialog"
          aria-label={label}
          minWidth={280}
        >
          <input
            className="input"
            placeholder={people ? "Buscar pessoa…" : "Buscar…"}
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                pick(shown[0].id);
              }
            }}
          />
          <ul
            className="m-0 mt-1.5 list-none overflow-y-auto rounded-md border border-border p-0"
            // ⚠️ CABE NO PAINEL: o `AnchoredPanel` tem teto de
            // `min(50vh, 320px)` e rola sozinho. Com a lista mais alta que o
            // que sobra dele (busca + respiro), apareciam DUAS barras de
            // rolagem (14/10). 84px = a busca, o espaço e o padding do painel.
            style={{ maxHeight: "min(calc(50vh - 84px), 236px)" }}
            aria-label={label}
          >
            {!search && (
              <Row selected={value === null} onPick={() => pick(null)}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2">
                  <Users size={13} className="text-ink-faint" aria-hidden="true" />
                </span>
                {allLabel}
              </Row>
            )}
            {shown.length === 0 ? (
              <li className="muted px-3 py-2.5 text-sm">Ninguém encontrado.</li>
            ) : (
              shown.map((o) => (
                <Row key={o.id} selected={o.id === value} onPick={() => pick(o.id)}>
                  {people && <Avatar id={o.id} name={o.name} size="sm" />}
                  <span className="min-w-0 truncate">{o.name}</span>
                </Row>
              ))
            )}
          </ul>
        </AnchoredPanel>
      )}
    </>
  );
}

function Row({
  selected,
  onPick,
  children,
}: {
  selected: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className={`flex w-full items-center gap-2.5 border-0 px-3 py-2 text-left text-md ${
          selected ? "bg-accent-soft font-semibold" : "bg-transparent hover:bg-surface-2"
        }`}
      >
        {children}
        {selected && <Check size={14} className="ml-auto shrink-0 text-accent" aria-hidden="true" />}
      </button>
    </li>
  );
}
