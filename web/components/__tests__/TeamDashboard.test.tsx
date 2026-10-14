// Spec 058, fatia D -- os cards da tela inicial.
//
// O QUE ESTE ARQUIVO PRENDE:
//   - D1: sem a carga na resposta (operador), o card não existe -- a tela não
//     decide permissão, só desenha o que veio;
//   - a carga mostra até 10 e "Ver todos";
//   - as tarefas citadas levam ao detalhe (`/tarefa/<id>`);
//   - semana sem tarefa nenhuma não vira "NaN%".
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TeamDashboard from "@/components/TeamDashboard";
import type { DashboardResponse } from "@/lib/api";

afterEach(cleanup);

const LINKS = { mine: "/minhas-tarefas?time=mkt", queue: "/solicitacoes?time=mkt" };

function resposta(over: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    today: "2026-10-14",
    week: { start: "2026-10-12", end: "2026-10-18", done: 14, total: 20 },
    overdue_total: 2,
    oldest_overdue: [
      { id: "t1", title: "Banner", due_date: "2026-10-10", due_time: null, parent_task_id: null },
    ],
    due_ahead: [
      { date: "2026-10-14", count: 2 },
      { date: "2026-10-15", count: 0 },
    ],
    mine: { overdue: [], overdue_total: 0, due_today: [], due_today_total: 0 },
    workload: null,
    queue: null,
    ...over,
  };
}

describe("TeamDashboard", () => {
  it("operador: sem o card de carga nem o de fila (D1)", () => {
    render(<TeamDashboard data={resposta()} links={LINKS} />);
    expect(screen.queryByRole("region", { name: "Tarefas abertas por pessoa" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Solicitações pendentes" })).toBeNull();
    // ⚠️ sem a fila, o quarto número é o das minhas atrasadas
    expect(screen.getByRole("region", { name: "Minhas atrasadas" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Minhas para hoje" })).toBeTruthy();
  });

  it("a semana: 14 de 20 em destaque, e o círculo diz 70%", () => {
    render(<TeamDashboard data={resposta()} links={LINKS} />);
    const destaque = screen.getByRole("region", { name: "Concluídas na semana" });
    expect(destaque.className).toContain("tile-destaque");
    expect(destaque.textContent).toContain("de 20");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it("semana sem tarefa com prazo diz isso, e não 'NaN'", () => {
    render(
      <TeamDashboard
        data={resposta({ week: { start: "2026-10-12", end: "2026-10-18", done: 0, total: 0 } })}
        links={LINKS}
      />
    );
    expect(screen.getByText("Nenhuma tarefa com prazo nesta semana.")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("a atrasada citada leva ao detalhe", () => {
    render(<TeamDashboard data={resposta()} links={LINKS} />);
    expect(screen.getByRole("link", { name: "Banner" }).getAttribute("href")).toBe("/tarefa/t1");
  });

  it("gestor: a carga mostra 10 e 'Ver todos' abre o resto", () => {
    const pessoas = Array.from({ length: 12 }, (_, i) => ({
      user_id: `u${i}`,
      name: `Pessoa ${i}`,
      open: 12 - i,
      overdue: i === 0 ? 3 : 0,
    }));
    render(
      <TeamDashboard
        data={resposta({ workload: pessoas, queue: { pending: 3, oldest_at: "2026-10-09T15:00:00Z" } })}
        links={LINKS}
      />
    );
    const carga = screen.getByRole("region", { name: "Tarefas abertas por pessoa" });
    expect(carga.querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByText("· 3 atrasadas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos (12)" }));
    expect(carga.querySelectorAll("li")).toHaveLength(12);
    // a fila, com a idade e o link do time
    expect(screen.getByText("a mais antiga chegou há 5 dias")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Abrir solicitações pendentes" }).getAttribute("href")
    ).toBe(LINKS.queue);
  });
});
