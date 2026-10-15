// Spec 058 -- a tela inicial do time: o que decide a tela (fatia C).
import { describe, expect, it } from "vitest";
import type { DashboardResponse } from "@/lib/api";
import {
  ageLabel,
  dashboardLayout,
  bucketLabel,
  periodLabel,
  presetOf,
  presetPeriod,
  shiftPeriod,
  isIsoDay,
  dayLabel,
  dueLabel,
  weekLabel,
  weekPercent,
} from "@/lib/teamDashboard";

function resposta(over: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    today: "2026-10-14",
    period: null,
    week: { start: "2026-10-12", end: "2026-10-18", done: 0, total: 0 },
    overdue_total: 0,
    oldest_overdue: [],
    on_time_total: 0,
    bucket_unit: "day",
    buckets: [],
    mine: { overdue: [], overdue_total: 0, on_time: [], on_time_total: 0 },
    workload: null,
    queue: null,
    ...over,
  };
}

describe("dashboardLayout", () => {
  it("operador (sem a carga): o que é dele logo depois do círculo", () => {
    const l = dashboardLayout(resposta());
    expect(l.cards).toEqual(["weekRing", "mine", "aheadChart", "overdueList"]);
    expect(l.manager).toBe(false);
  });

  it("⚠️ sem a fila, o quarto número vira 'Minhas atrasadas' -- a fileira não fica com buraco", () => {
    expect(dashboardLayout(resposta()).tiles).toEqual([
      "weekDone",
      "overdue",
      "dueToday",
      "myOverdue",
    ]);
    expect(
      dashboardLayout(resposta({ queue: { pending: 1, oldest_at: null } })).tiles
    ).toEqual(["weekDone", "overdue", "dueToday", "queue"]);
  });

  it("gestor: a carga entra", () => {
    const l = dashboardLayout(resposta({ workload: [] }));
    expect(l.cards).toEqual(["weekRing", "aheadChart", "overdueList", "workload", "mine"]);
    expect(l.manager).toBe(true);
  });
});

describe("textos", () => {
  it("semana e porcentagem (semana vazia é 0, não NaN)", () => {
    expect(weekLabel("2026-10-12", "2026-10-18")).toBe("12/10 a 18/10");
    expect(weekPercent(14, 20)).toBe(70);
    expect(weekPercent(0, 0)).toBe(0);
  });

  it("os dias dos próximos 7", () => {
    expect(dayLabel("2026-10-14", "2026-10-14")).toBe("Hoje");
    expect(dayLabel("2026-10-15", "2026-10-14")).toBe("Amanhã");
    expect(dayLabel("2026-10-16", "2026-10-14")).toBe("Sex 16");
    // virada de mês
    expect(dayLabel("2026-11-01", "2026-10-30")).toBe("Dom 1");
  });

  it("prazo de tarefa citada", () => {
    const t = {
      id: "t",
      title: "x",
      parent_task_id: null,
      priority: "MEDIUM",
      column_name: "Backlog",
      column_color: "var(--status-backlog-dot)",
    };
    expect(dueLabel({ ...t, due_date: "2026-10-10", due_time: null }, "2026-10-14")).toBe("10/10");
    expect(dueLabel({ ...t, due_date: "2026-10-14", due_time: "14:00:00" }, "2026-10-14")).toBe(
      "hoje 14:00"
    );
  });

  it("⚠️ idade da fila em dia de calendário, no fuso da organização", () => {
    // 02:00 UTC do dia 14 = 23:00 do dia 13 em São Paulo -> ontem
    expect(ageLabel("2026-10-14T02:00:00Z", "2026-10-14")).toBe("há 1 dia");
    expect(ageLabel("2026-10-14T15:00:00Z", "2026-10-14")).toBe("hoje");
    expect(ageLabel("2026-10-09T15:00:00Z", "2026-10-14")).toBe("há 5 dias");
  });
});

describe("período (15/10)", () => {
  // quarta, 14/10/2026
  const HOJE = "2026-10-14";

  it("os atalhos partem do hoje do servidor; a semana começa na segunda", () => {
    expect(presetPeriod("now", HOJE)).toBeNull();
    expect(presetPeriod("thisWeek", HOJE)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(presetPeriod("lastWeek", HOJE)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(presetPeriod("nextWeek", HOJE)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(presetPeriod("thisMonth", HOJE)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(presetPeriod("lastMonth", HOJE)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    // domingo ainda é da semana que começou na segunda anterior
    expect(presetPeriod("thisWeek", "2026-10-18")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("⚠️ mês anda por mês (e não 30 dias); o resto anda pelo próprio tamanho", () => {
    expect(shiftPeriod({ start: "2026-10-01", end: "2026-10-31" }, -1)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(shiftPeriod({ start: "2026-12-01", end: "2026-12-31" }, 1)).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(shiftPeriod({ start: "2026-10-01", end: "2026-10-05" }, 1)).toEqual({
      start: "2026-10-06",
      end: "2026-10-10",
    });
  });

  it("o nome: o do atalho, ou as datas", () => {
    expect(periodLabel(null, HOJE)).toBe("Agora");
    expect(periodLabel({ start: "2026-10-05", end: "2026-10-11" }, HOJE)).toBe("Semana passada");
    expect(periodLabel({ start: "2026-10-01", end: "2026-10-05" }, HOJE)).toBe("01/10 a 05/10");
    expect(presetOf({ start: "2026-10-01", end: "2026-10-05" }, HOJE)).toBeNull();
  });

  it("colunas: o dia, ou a semana (com o mês só no fim quando não vira)", () => {
    expect(bucketLabel({ start: HOJE, end: HOJE }, "day", HOJE)).toBe("Hoje");
    expect(bucketLabel({ start: "2026-10-16", end: "2026-10-16" }, "day", HOJE)).toBe("Sex");
    expect(bucketLabel({ start: "2026-10-12", end: "2026-10-18" }, "week", HOJE)).toBe("12–18/10");
    expect(bucketLabel({ start: "2026-09-28", end: "2026-10-04" }, "week", HOJE)).toBe(
      "28/09–04/10"
    );
  });

  it("data da URL só se for de verdade", () => {
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay(null)).toBe(false);
  });
});

