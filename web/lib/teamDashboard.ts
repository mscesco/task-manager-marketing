// lib/teamDashboard.ts
// A tela inicial do time (Spec 058) -- o que DECIDE, separado do que desenha
// (a fronteira da Spec 027). Os cards só desenham.
//
// ⚠️ SEM `Date`: os dias vêm do servidor como "YYYY-MM-DD", já no fuso da
// organização, e a aritmética é a do calendário da Base (`baseViews.ts`) --
// dia é calendário, não instante (web/AGENTS.md §0.1).

import type { DashboardResponse, DashboardTask } from "./api";
import { dataDosDias, diaDaSemana, diasDesdeEpoca, diasNoMes } from "./baseViews";
import { diaNoWorkspace } from "./prazo";

/** Os números grandes da fileira de cima. */
export type DashboardTile = "weekDone" | "overdue" | "dueToday" | "queue" | "myOverdue";

/** Os cards da grade de baixo. */
export type DashboardCard = "weekRing" | "aheadChart" | "overdueList" | "workload" | "mine";

export type DashboardLayout = {
  tiles: DashboardTile[];
  cards: DashboardCard[];
  /** Quem recebe a carga por pessoa desenha a grade de gestor. */
  manager: boolean;
};

/**
 * O desenho da tela (Spec 058 §5; o layout em blocos é pedido dela, 14/10, com
 * uma referência de painel).
 *
 * ⚠️ QUEM É GESTOR SE DESCOBRE PELA RESPOSTA, e não por uma segunda regra de
 * permissão na tela: a carga só vem para quem tem `team_workload.read`. Sem
 * ela, a pessoa é tratada como operador -- o que é dela primeiro (D1).
 *
 * ⚠️ SEMPRE QUATRO NÚMEROS EM CIMA: sem a fila (quem não tem
 * `solicitation.read`), o quarto vira "Minhas atrasadas" -- o número que mais
 * importa para quem executa --, e a fileira não fica com um buraco.
 */
export function dashboardLayout(d: DashboardResponse): DashboardLayout {
  const manager = d.workload !== null;
  return {
    tiles: ["weekDone", "overdue", "dueToday", d.queue !== null ? "queue" : "myOverdue"],
    cards: manager
      ? ["weekRing", "aheadChart", "overdueList", "workload", "mine"]
      : ["weekRing", "mine", "aheadChart", "overdueList"],
    manager,
  };
}


/** "12/10 a 18/10". */
export function weekLabel(start: string, end: string): string {
  return `${dayMonth(start)} a ${dayMonth(end)}`;
}

/** 0 a 100. Semana sem nenhuma tarefa com prazo é 0, e não `NaN`. */
export function weekPercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** O rótulo de um dia dos próximos 7: "Hoje", "Amanhã", "Sex 17". */
export function dayLabel(day: string, today: string): string {
  const diff = epochDay(day) - epochDay(today);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  const [a, m, d] = day.split("-").map(Number);
  return `${WEEKDAY_SHORT[diaDaSemana(a, m, d)]} ${d}`;
}

/** O dia da semana curto, para o pé das colunas: "Qua". */
export function weekdayShort(day: string): string {
  const [a, m, d] = day.split("-").map(Number);
  return WEEKDAY_SHORT[diaDaSemana(a, m, d)];
}

/** O prazo de uma tarefa citada: "10/10", ou "hoje 14:00". */
export function dueLabel(t: DashboardTask, today: string): string {
  if (!t.due_date) return "";
  const time = t.due_time ? ` ${t.due_time.slice(0, 5)}` : "";
  return t.due_date === today ? `hoje${time}` : `${dayMonth(t.due_date)}${time}`;
}

/**
 * Há quanto tempo chegou a solicitação mais antiga: "hoje", "há 1 dia",
 * "há 5 dias". Conta em DIAS DE CALENDÁRIO no fuso da organização: a que
 * chegou ontem às 23h é "há 1 dia" já à meia-noite.
 */
export function ageLabel(oldestAt: string, today: string): string {
  const n = epochDay(today) - epochDay(diaNoWorkspace(oldestAt));
  if (n <= 0) return "hoje";
  return n === 1 ? "há 1 dia" : `há ${n} dias`;
}

/** O rótulo de uma coluna do gráfico: o dia ("Hoje", "Qua"), ou a semana
 *  ("12–18/10"; "29/09–05/10" quando vira o mês). */
export function bucketLabel(
  b: { start: string; end: string },
  unit: "day" | "week",
  today: string
): string {
  if (unit === "day") {
    return b.start === today ? "Hoje" : weekdayShort(b.start);
  }
  const mesmoMes = b.start.slice(5, 7) === b.end.slice(5, 7);
  return mesmoMes
    ? `${b.start.slice(8, 10)}–${dayMonth(b.end)}`
    : `${dayMonth(b.start)}–${dayMonth(b.end)}`;
}

// ------------------------------------------------------------ período (15/10)
// Pedido dela: escolher a data e TUDO se adaptar a ela -- no estado de hoje
// (a regra mora no servidor). Aqui só o que a tela decide: os atalhos, andar
// para trás e para a frente, e o nome do período.

export type Period = { start: string; end: string };
export type PeriodPreset = "now" | "thisWeek" | "lastWeek" | "nextWeek" | "thisMonth" | "lastMonth";

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "now", label: "Agora" },
  { id: "thisWeek", label: "Esta semana" },
  { id: "lastWeek", label: "Semana passada" },
  { id: "nextWeek", label: "Próxima semana" },
  { id: "thisMonth", label: "Este mês" },
  { id: "lastMonth", label: "Mês passado" },
];

/** O período de um atalho, a partir do "hoje" do servidor. `now` = sem período. */
export function presetPeriod(id: PeriodPreset, today: string): Period | null {
  const segunda = addDays(today, -mondayOffset(today));
  switch (id) {
    case "now":
      return null;
    case "thisWeek":
      return { start: segunda, end: addDays(segunda, 6) };
    case "lastWeek":
      return { start: addDays(segunda, -7), end: addDays(segunda, -1) };
    case "nextWeek":
      return { start: addDays(segunda, 7), end: addDays(segunda, 13) };
    case "thisMonth":
      return monthOf(today);
    case "lastMonth":
      return monthOf(addDays(`${today.slice(0, 7)}-01`, -1));
  }
}

/** Qual atalho é este período (para o seletor dizer "Esta semana"). */
export function presetOf(p: Period | null, today: string): PeriodPreset | null {
  if (p === null) return "now";
  for (const { id } of PERIOD_PRESETS) {
    const q = presetPeriod(id, today);
    if (q && q.start === p.start && q.end === p.end) return id;
  }
  return null;
}

/**
 * Anda o período inteiro para trás (-1) ou para a frente (+1).
 *
 * ⚠️ MÊS ANDA POR MÊS, e não por 30 dias: outubro para trás é setembro
 * inteiro, e não "2 de setembro a 1 de outubro". O resto anda pelo próprio
 * tamanho (uma semana anda uma semana).
 */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  if (isWholeMonth(p)) {
    const [a, m] = p.start.split("-").map(Number);
    const total = a * 12 + (m - 1) + dir;
    return monthOf(`${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`);
  }
  const n = epochDay(p.end) - epochDay(p.start) + 1;
  return { start: addDays(p.start, dir * n), end: addDays(p.end, dir * n) };
}

/** "12/10 a 18/10" -- ou o nome do atalho, quando é um. */
export function periodLabel(p: Period | null, today: string): string {
  const preset = presetOf(p, today);
  if (preset) return PERIOD_PRESETS.find((x) => x.id === preset)!.label;
  return p ? weekLabel(p.start, p.end) : "Agora";
}

/** Data válida "YYYY-MM-DD" (o que a URL pode trazer). */
export function isIsoDay(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasNoMes(a, m);
}

function mondayOffset(day: string): number {
  const [a, m, d] = day.split("-").map(Number);
  return (diaDaSemana(a, m, d) + 6) % 7; // domingo=0 -> 6; segunda=1 -> 0
}

function monthOf(day: string): Period {
  const [a, m] = day.split("-").map(Number);
  return { start: `${a}-${pad(m)}-01`, end: `${a}-${pad(m)}-${pad(diasNoMes(a, m))}` };
}

function isWholeMonth(p: Period): boolean {
  const mes = monthOf(p.start);
  return mes.start === p.start && mes.end === p.end;
}

function addDays(day: string, n: number): string {
  return dataDosDias(epochDay(day) + n);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Quantos cabem no card da carga antes do "Ver todos" (§10.5). */
export const WORKLOAD_PREVIEW = 10;

function epochDay(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return diasDesdeEpoca(a, m, d);
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
