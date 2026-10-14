// Spec 058 -- a tela inicial do time: o que decide a tela (fatia C).
import { describe, expect, it } from "vitest";
import type { DashboardResponse } from "@/lib/api";
import {
  ageLabel,
  cardOrder,
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

describe("cardOrder", () => {
  it("operador (sem a carga): o que é dele primeiro, e sem a fila", () => {
    expect(cardOrder(resposta())).toEqual(["mine", "week", "overdue", "ahead"]);
  });

  it("gestor: o que pede ação em cima, o pessoal no fim", () => {
    expect(
      cardOrder(resposta({ workload: [], queue: { pending: 1, oldest_at: null } }))
    ).toEqual(["week", "overdue", "queue", "workload", "ahead", "mine"]);
  });

  it("⚠️ supervisor tem a carga mas não a fila: a fila some, o resto fica", () => {
    expect(cardOrder(resposta({ workload: [] }))).toEqual([
      "week",
      "overdue",
      "workload",
      "ahead",
      "mine",
    ]);
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
    const t = { id: "t", title: "x", parent_task_id: null };
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
