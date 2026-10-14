// lib/teamDashboard.ts
// A tela inicial do time (Spec 058) -- o que DECIDE, separado do que desenha
// (a fronteira da Spec 027). Os cards só desenham.
//
// ⚠️ SEM `Date`: os dias vêm do servidor como "YYYY-MM-DD", já no fuso da
// organização, e a aritmética é a do calendário da Base (`baseViews.ts`) --
// dia é calendário, não instante (web/AGENTS.md §0.1).

import type { DashboardResponse, DashboardTask } from "./api";
import { diaDaSemana, diasDesdeEpoca } from "./baseViews";
import { diaNoWorkspace } from "./prazo";

/** Os números grandes da fileira de cima. */
export type DashboardTile = "weekDone" | "overdue" | "dueToday" | "queue" | "myOverdue";

/** Os cards da grade de baixo. */
export type DashboardCard = "weekRing" | "aheadChart" | "overdueList" | "workload" | "mine";

export type DashboardLayout = {
  tiles: DashboardTile[];
  cards: DashboardCard[];
  /** Sem a carga, "Minhas" ocupa o lugar dela e fica larga. */
  wideMine: boolean;
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
    wideMine: !manager,
  };
}

/** Quantas vencem hoje no time (e ainda não atrasaram): o dia de hoje do gráfico. */
export function dueTodayCount(d: DashboardResponse): number {
  return d.due_ahead.find((x) => x.date === d.today)?.count ?? 0;
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

/** Quantos cabem no card da carga antes do "Ver todos" (§10.5). */
export const WORKLOAD_PREVIEW = 10;

function epochDay(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return diasDesdeEpoca(a, m, d);
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
