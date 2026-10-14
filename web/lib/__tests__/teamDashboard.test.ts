// Spec 058 -- a tela inicial do time: o que decide a tela (fatia C).
import { describe, expect, it } from "vitest";
import type { DashboardResponse } from "@/lib/api";
import {
  ageLabel,
  dashboardLayout,
  dueTodayCount,
  dayLabel,
  dueLabel,
  weekLabel,
  weekPercent,
} from "@/lib/teamDashboard";

function resposta(over: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    today: "2026-10-14",
    week: { start: "2026-10-12", end: "2026-10-18", done: 0, total: 0 },
    overdue_total: 0,
    oldest_overdue: [],
    due_ahead: [],
    mine: { overdue: [], overdue_total: 0, due_today: [], due_today_total: 0 },
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

  it("vencem hoje = o dia de hoje do gráfico", () => {
    const d = resposta({
      due_ahead: [
        { date: "2026-10-14", count: 3 },
        { date: "2026-10-15", count: 1 },
      ],
    });
    expect(dueTodayCount(d)).toBe(3);
    expect(dueTodayCount(resposta())).toBe(0);
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
