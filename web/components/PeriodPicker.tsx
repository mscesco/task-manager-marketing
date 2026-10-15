"use client";
// components/PeriodPicker.tsx
// O filtro de período da tela inicial (Spec 058, 15/10).
//
// Pedido dela: escolher a data e TUDO se adaptar a ela -- no estado de hoje
// (a regra mora no servidor). Atalhos ("Esta semana", "Mês passado"…), um
// período personalizado (de / até), e as setas ← → que andam o período
// inteiro. Mesmo desenho do `FilterPicker`: botão arredondado, painel
// ancorado, a escolha fecha o painel.

import { useCallback, useState } from "react";
import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import {
  PERIOD_PRESETS,
  isIsoDay,
  periodLabel,
  presetOf,
  presetPeriod,
  shiftPeriod,
  type Period,
} from "@/lib/teamDashboard";

/** O teto do servidor (`MAX_PERIOD_DAYS`). */
const MAX_DAYS = 366;

export default function PeriodPicker({
  value,
  today,
  onChange,
}: {
  value: Period | null;
  /** O "hoje" do servidor: os atalhos partem dele, e não do relógio da máquina. */
  today: string;
  onChange: (p: Period | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value?.start ?? today);
  const [to, setTo] = useState(value?.end ?? today);
  const [error, setError] = useState<string | null>(null);
  const panel = useAnchoredPanel<HTMLButtonElement>(open, () => close(), { larguraPainel: 300 });
  const anchor = panel.anchorRef;
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    anchor.current?.focus();
  }, [anchor]);

  const current = presetOf(value, today);
  const label = periodLabel(value, today);

  function pick(p: Period | null) {
    onChange(p);
    close();
  }

  function applyCustom() {
    if (!isIsoDay(from) || !isIsoDay(to)) return setError("Escolha as duas datas.");
    if (to < from) return setError("O fim vem antes do início.");
    const dias = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (dias > MAX_DAYS) return setError("O período pode ter até um ano.");
    pick({ start: from, end: to });
  }

  return (
    <div className="flex items-center gap-1">
      {value && (
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink-soft hover:border-accent hover:text-accent"
          aria-label="Período anterior"
          onClick={() => onChange(shiftPeriod(value, -1))}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      )}
      <button
        ref={panel.anchorRef}
        type="button"
        aria-label={`Período: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setFrom(value?.start ?? today);
          setTo(value?.end ?? today);
          setOpen(true);
        }}
        className={`flex h-9 min-w-[170px] max-w-[260px] items-center gap-2 rounded-full border bg-surface px-3 text-base transition-[border-color] duration-150 hover:border-accent ${
          value ? "border-accent" : "border-border"
        }`}
      >
        <span className="text-xs text-ink-faint">Período</span>
        <CalendarRange size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left font-semibold">{label}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
      {value && (
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink-soft hover:border-accent hover:text-accent"
          aria-label="Próximo período"
          onClick={() => onChange(shiftPeriod(value, 1))}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {open && panel.box && (
        <AnchoredPanel box={panel.box} panelRef={panel.panelRef} role="dialog" aria-label="Período" minWidth={300}>
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border p-0" aria-label="Atalhos">
            {PERIOD_PRESETS.map((p) => {
              const selected = current === p.id;
              return (
                <li key={p.id} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pick(presetPeriod(p.id, today))}
                    className={`flex w-full items-center gap-2 border-0 px-3 py-2 text-left text-md ${
                      selected ? "bg-accent-soft font-semibold" : "bg-transparent hover:bg-surface-2"
                    }`}
                  >
                    {p.label}
                    {selected && <Check size={14} className="ml-auto text-accent" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <form
            className="mt-2 flex flex-col gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              applyCustom();
            }}
          >
            <p className="m-0 text-xs font-semibold text-ink-soft">Personalizado</p>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 flex-col gap-0.5 text-xs text-ink-faint">
                De
                <input
                  type="date"
                  className="input"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="flex flex-1 flex-col gap-0.5 text-xs text-ink-faint">
                Até
                <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            {error && (
              <p className="m-0 text-xs text-danger" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary self-end">
              Aplicar
            </button>
          </form>
        </AnchoredPanel>
      )}
    </div>
  );
}
