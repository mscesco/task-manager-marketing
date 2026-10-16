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
    period: null,
    week: { start: "2026-10-12", end: "2026-10-18", done: 14, total: 20 },
    overdue_total: 2,
    oldest_overdue: [
      {
        id: "t1",
        title: "Banner",
        due_date: "2026-10-10",
        due_time: null,
        parent_task_id: null,
        priority: "HIGH",
        column_name: "Em Andamento",
        column_color: "var(--status-progress-dot)",
      },
    ],
    on_time_total: 2,
    bucket_unit: "day",
    buckets: [
      { start: "2026-10-14", end: "2026-10-14", done: 0, on_time: 2, overdue: 1 },
      { start: "2026-10-15", end: "2026-10-15", done: 0, on_time: 0, overdue: 0 },
    ],
    mine: { overdue: [], overdue_total: 0, on_time: [], on_time_total: 0 },
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
    // O bloco inteiro é o link: título, coluna, prioridade e prazo.
    const link = screen.getByRole("link", { name: /Banner/ });
    expect(link.getAttribute("href")).toBe("/tarefa/t1");
    expect(link.textContent).toContain("Em Andamento");
    expect(link.textContent).toContain("Alta");
    expect(link.textContent).toContain("10/10");
  });

  it("gestor: a carga mostra 10 e 'Ver todos' abre o resto", () => {
    const pessoas = Array.from({ length: 12 }, (_, i) => ({
      user_id: `u${i}`,
      name: `Pessoa ${i}`,
      open: 12 - i,
      overdue: i === 0 ? 3 : 0,
      is_active: true,
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

  it("filtrado por pessoa: 'Minhas' vira dela, e o nome na carga filtra", () => {
    const escolhidos: string[] = [];
    render(
      <TeamDashboard
        data={resposta({ workload: [{ user_id: "u1", name: "Ana Souza", open: 3, overdue: 0, is_active: true }] })}
        links={LINKS}
        personName="Ana Souza"
        onPickPerson={(id) => escolhidos.push(id)}
      />
    );
    expect(screen.getByRole("region", { name: "Ana para hoje" })).toBeTruthy();
    // ⚠️ os números de cima também são dela (revisão de 15/10)
    expect(screen.getByRole("region", { name: "Atrasadas de Ana" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ver todas as minhas tarefas" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ana Souza" }));
    expect(escolhidos).toEqual(["u1"]);
  });

  it("conta desativada com tarefa aberta aparece na carga, marcada", () => {
    render(
      <TeamDashboard
        data={resposta({
          workload: [{ user_id: "u9", name: "Juliana", open: 2, overdue: 1, is_active: false }],
        })}
        links={LINKS}
      />
    );
    expect(screen.getByText("(inativo)")).toBeTruthy();
  });

  it("com período, os rótulos dizem período, e o gráfico empilha", () => {
    render(
      <TeamDashboard
        data={resposta({ period: { start: "2026-10-01", end: "2026-10-05" } })}
        links={LINKS}
      />
    );
    expect(screen.getByRole("region", { name: "Concluídas no período" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Em aberto no prazo" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Progresso do período" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Minhas no período" })).toBeTruthy();
    // a coluna diz o que tem dentro, para quem não vê as cores
    expect(screen.getByLabelText("Hoje: 0 concluídas, 2 no prazo, 1 atrasadas")).toBeTruthy();
  });
});

