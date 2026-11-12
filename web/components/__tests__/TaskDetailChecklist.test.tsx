// A checklist e as pílulas do DETALHE decidem pela COLUNA, não pelo `status`:
//   - a conta e a marca da caixinha saem da coluna;
//   - a escrita manda `column_id`, e não `status`;
//   - desmarcar manda para a coluna aberta padrão (`is_default_target`);
//   - enquanto as colunas não chegam, não há número, em vez de um errado.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Task } from "@/lib/api";

// `importOriginal`: o `TaskDetail` importa outros exports de `@/lib/api`, e
// uma fábrica seca os deixaria `undefined`.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    // Sem isto a busca de links vai à rede, falha, e um role=alert entra na tela.
    getTaskLinks: async () => [],
    colunasDoQuadro: vi.fn(),
    // O painel busca as próprias filhas; quem reflete a caixinha na tela é o
    // `upsertFilhaLocal` do componente.
    listarFilhas: vi.fn(),
    updateTask: vi.fn(),
    listComments: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
  };
});

const api = await import("@/lib/api");

const QUADRO = "board-geral";

const COLUNAS: Coluna[] = [
  // ⚠️ `Planejado` vem PRIMEIRO por posição e `Backlog` é o alvo padrão: sem
  // isso, "a primeira aberta" e "a marcada como padrão" dariam a mesma resposta.
  {
    id: "col-planejado",
    name: "Planejado",
    color: "var(--status-planned-dot)",
    position: 0,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: false,
    is_status_bridge: false,
  },
  {
    id: "col-backlog",
    name: "Backlog",
    color: "var(--status-backlog-dot)",
    position: 1,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
  {
    id: "col-done",
    name: "Concluído",
    color: "var(--status-done-dot)",
    position: 5,
    semantic: "DONE",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
];

function task(over: Partial<Task> = {}): Task {
  // ⚠️ Literal completo, SEM `as`: fixture com `as` cala o `tsc` sobre campo
  // que falta ou não existe.
  return {
    id: "t1",
    title: "Tarefa",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    due_time: null,
    project_id: null,
    parent_task_id: null,
    team_id: "team-marketing",
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: "user-1",
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    assignee_ids: [],
    board_id: QUADRO,
    column_id: "col-backlog",
    can_delete: true,
    ...over,
  };
}

function Pai({
  inicial,
  onSubtaskUpsert,
  tarefa,
  members,
}: {
  inicial: Task[];
  onSubtaskUpsert?: (sub: Task) => void;
  // Só os testes de responsável precisam; os demais seguem com o mapa vazio.
  members?: Map<string, { name: string }>;
  // A tarefa FOCADA. Default = a mae generica; os testes do badge passam uma
  // com coluna especifica.
  tarefa?: Task;
}) {
  // As filhas chegam pelo mock de `listarFilhas` (ver `montar`), não por prop.
  void inicial;
  return (
    <TaskDetail
      task={tarefa ?? task({ id: "pai", title: "Tarefa mãe", path: "pai" })}
      members={members ?? new Map()}
      projects={new Map()}
      temVoltar={false}
      onVoltar={vi.fn()}
      onClose={vi.fn()}
      onDuplicar={vi.fn()}
      onAssigneesChange={vi.fn()}
      onAbrirSubtarefa={vi.fn()}
      onSubtaskUpsert={(sub) => {
        onSubtaskUpsert?.(sub);
      }}
      onTaskMoved={vi.fn()}
      onExcluir={vi.fn()}
      mostrarArquivadas={false}
      membrosInativos={new Set()}
    />
  );
}

function montar(
  filhos: Task[],
  onSubtaskUpsert?: (sub: Task) => void,
  members?: Map<string, { name: string }>
) {
  vi.mocked(api.listarFilhas).mockResolvedValue(filhos);
  render(
    <Pai
      inicial={filhos}
      onSubtaskUpsert={onSubtaskUpsert}
      members={members}
    />
  );
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
  vi.mocked(api.listComments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.currentUser).mockResolvedValue(null as never);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.getRootTeamId).mockResolvedValue("team-marketing");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDetail -- a checklist conta pela coluna", () => {
  it("conta pela COLUNA mesmo com o status dizendo outra coisa", async () => {
    // Par torto real logo depois de arrastar: a atualização otimista move a
    // coluna e o `status` só chega na resposta.
    montar([
      task({
        id: "f1",
        title: "Filha",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        status: "BACKLOG",
        column_id: "col-done",
      }),
    ]);

    expect(await screen.findByText(/Subtarefas \(1\/1\)/)).toBeTruthy();
    expect(
      screen.getByLabelText("1 de 1 subtarefas concluídas (100%)")
    ).toBeTruthy();
  });

  it("a caixinha aparece marcada pela coluna", async () => {
    montar([
      task({
        id: "f1",
        title: "Filha pronta",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        status: "BACKLOG",
        column_id: "col-done",
      }),
    ]);
    await screen.findByText(/Subtarefas \(1\/1\)/);

    // Se a marca sair de `status`, a caixa fica desmarcada com a barra em 100%.
    expect(
      (screen.getByTitle("Reabrir") as HTMLInputElement).checked
    ).toBe(true);
  });

  it("⚠️ concluir a subtarefa NAO pode apagar o responsavel dela", async () => {
    // `PATCH /tasks/{id}` responde sem `assignee_ids`; substituir a filha pela
    // resposta crua apagaria o responsável da memória.
    // ⚠️ Este mock imita o servidor (sem o campo). Os outros mocks deste
    // arquivo fazem `{...f, ...}` e devolvem o campo, então não pegariam isso.
    const f = task({
      id: "f1",
      title: "Filha com responsável",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
      assignee_ids: ["u1"],
    });
    const { assignee_ids: _semEsteCampo, ...comoOBackendResponde } = f;
    vi.mocked(api.updateTask).mockResolvedValue({
      ...comoOBackendResponde,
      column_id: "col-done",
      status: "COMPLETED",
    } as Task);

    montar([f], undefined, new Map([["u1", { name: "Ana" }]]));
    await screen.findByTitle("Ana");

    fireEvent.click(screen.getByTitle("Concluir"));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());

    // A bolinha tem de continuar la DEPOIS que a resposta do PATCH chega.
    expect(screen.getByTitle("Ana")).toBeTruthy();
  });

  it("⚠️ o servidor recusou: a caixinha VOLTA e a tela diz", async () => {
    const f = task({
      id: "f1",
      title: "Filha",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
    });
    vi.mocked(api.updateTask).mockRejectedValue(new Error("recusado"));

    montar([f]);
    fireEvent.click(await screen.findByTitle("Concluir"));
    await screen.findByText("Não consegui atualizar a subtarefa.");

    expect((screen.getByTitle("Concluir") as HTMLInputElement).checked).toBe(false);
  });

  it("marcar manda `column_id`, e NUNCA `status`", async () => {
    const f = task({
      id: "f1",
      title: "Filha aberta",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
    });
    vi.mocked(api.updateTask).mockResolvedValue({
      ...f,
      column_id: "col-done",
      status: "COMPLETED",
    });
    montar([f]);
    await screen.findByText(/Subtarefas \(0\/1\)/);

    fireEvent.click(screen.getByTitle("Concluir"));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("f1", {
        column_id: "col-done",
      });
    });
    // ⚠️ O payload tem UMA chave: mandar `status` junto é 422 no backend.
    const payload = vi.mocked(api.updateTask).mock.calls[0][1];
    expect(Object.keys(payload)).toEqual(["column_id"]);
  });

  /**
   * Regra fixa: o mesmo clique dá sempre a mesma resposta. Não é "a primeira
   * coluna aberta", é a marcada como `is_default_target` (a fixture tem duas
   * abertas, e só a flag as separa).
   */
  it("desmarcar manda SEMPRE para a coluna aberta padrão", async () => {
    const f = task({
      id: "f1",
      title: "Filha pronta",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-done",
    });
    vi.mocked(api.updateTask).mockResolvedValue({ ...f, column_id: "col-backlog" });
    montar([f]);
    await screen.findByText(/Subtarefas \(1\/1\)/);

    fireEvent.click(screen.getByTitle("Reabrir"));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("f1", {
        column_id: "col-backlog",
      });
    });
  });

  /**
   * O preço da regra fixa, e é escolhido: marcar e desmarcar NÃO devolve a
   * subtarefa para onde ela estava.
   */
  it("marcar e desmarcar NÃO devolve para a coluna de origem", async () => {
    const f = task({
      id: "f1",
      title: "Filha planejada",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
    });
    vi.mocked(api.updateTask).mockImplementation(async (_id, corpo) => ({
      ...f,
      column_id: (corpo as { column_id: string }).column_id,
    }));
    montar([f]);
    await screen.findByText(/Subtarefas \(0\/1\)/);

    fireEvent.click(screen.getByTitle("Concluir"));
    await screen.findByTitle("Reabrir");
    fireEvent.click(screen.getByTitle("Reabrir"));

    await waitFor(() => {
      expect(vi.mocked(api.updateTask).mock.calls).toHaveLength(2);
    });
    expect(vi.mocked(api.updateTask).mock.calls[1][1]).toEqual({
      column_id: "col-backlog",
    });
  });

  it("sem as colunas não há número -- e a caixinha fica travada", async () => {
    let liberar!: (c: Coluna[]) => void;
    vi.mocked(api.colunasDoQuadro).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );
    montar([
      task({
        id: "f1",
        title: "Filha",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        column_id: "col-done",
      }),
    ]);

    // ⚠️ "Subtarefas" SEM "(x/y)": com o mapa vazio a conta daria "(0/1)".
    await screen.findByText("Subtarefas");
    expect(screen.queryByText(/Subtarefas \(/)).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
      true
    );

    liberar(COLUNAS);
    expect(await screen.findByText(/Subtarefas \(1\/1\)/)).toBeTruthy();
  });
});

describe("TaskDetail -- o badge sai da coluna", () => {
  it("mostra o nome da coluna, e não o rótulo do status", async () => {
    render(
      <Pai
        inicial={[]}
        tarefa={task({
          id: "pai",
          title: "Mãe",
          path: "pai",
          // Par torto: o status diz BACKLOG, a coluna é `Planejado`.
          status: "BACKLOG",
          column_id: "col-planejado",
        })}
      />
    );

    expect(await screen.findByText("Planejado")).toBeTruthy();
    expect(screen.queryByText("Backlog")).toBeNull();
  });

  /**
   * A reserva: coluna fora da lista carregada (quadro sem alcance, coluna
   * apagada) cai no rótulo do status, e não em branco.
   */
  it("coluna desconhecida cai no rótulo do status, e não em branco", async () => {
    render(
      <Pai
        inicial={[]}
        tarefa={task({
          id: "pai",
          title: "Mãe",
          path: "pai",
          status: "IN_PROGRESS",
          column_id: "col-de-outro-quadro",
        })}
      />
    );

    expect(await screen.findByText("Em Andamento")).toBeTruthy();
  });
});

describe("TaskDetail -- a pílula de prioridade abre e grava", () => {
  it("clicar na pílula abre a lista com as quatro, na ordem do enum", async () => {
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));

    const lista = await screen.findByRole("listbox", { name: "Prioridade" });
    const opcoes = within(lista).getAllByRole("option");
    // ⚠️ Prende a ordem RENDERIZADA, não a origem: `PRIORITY_LABEL` está
    // declarado nesta mesma ordem, então trocar `PRIORIDADES` por
    // `Object.keys(PRIORITY_LABEL)` não derruba este teste.
    expect(opcoes.map((o) => o.textContent)).toEqual([
      "Baixa",
      "Media",
      "Alta",
      "Urgente",
    ]);
  });

  it("escolher grava com `priority` e SÓ com ele", async () => {
    const salva = task({ id: "pai", title: "Tarefa mãe", path: "pai" });
    vi.mocked(api.updateTask).mockResolvedValue({ ...salva, priority: "URGENT" });
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));
    fireEvent.click(await screen.findByRole("option", { name: "Urgente" }));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("pai", { priority: "URGENT" });
    });
    // ⚠️ Uma chave só: o `updateTask` manda `body: input` inteiro, então
    // qualquer campo a mais viaja.
    const payload = vi.mocked(api.updateTask).mock.calls[0][1];
    expect(Object.keys(payload)).toEqual(["priority"]);
  });

  it("⚠️ escolher a MESMA prioridade não manda requisição", async () => {
    // Sem esta guarda, abrir a lista e clicar no que já está marcado gasta um
    // PATCH e uma linha de histórico para não mudar nada.
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));
    fireEvent.click(await screen.findByRole("option", { name: "Media" }));

    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

describe("TaskDetail -- a pílula de coluna abre e grava", () => {
  it("lista as colunas na ordem de `position`, e não na da API", async () => {
    // ⚠️ Na fixture a ordem do array já é a de `position`; por isso a API
    // devolve a lista REVERTIDA só aqui (mexer na fixture quebraria o teste
    // do alvo padrão).
    vi.mocked(api.colunasDoQuadro).mockResolvedValue([...COLUNAS].reverse());
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(await screen.findByTitle("Mudar de coluna"));

    const lista = await screen.findByRole("listbox", { name: "Coluna" });
    expect(
      within(lista)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["Planejado", "Backlog", "Concluído"]);
  });

  it("⚠️ grava `column_id` e NUNCA `status`", async () => {
    const salva = task({ id: "pai", title: "Tarefa mãe", path: "pai" });
    vi.mocked(api.updateTask).mockResolvedValue({
      ...salva,
      column_id: "col-done",
      status: "COMPLETED",
    });
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(await screen.findByTitle("Mudar de coluna"));
    fireEvent.click(await screen.findByRole("option", { name: "Concluído" }));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("pai", {
        column_id: "col-done",
      });
    });
    // Uma chave só: `updateTask` manda `body: input` inteiro, então mandar
    // `status` junto seria 422 no backend.
    expect(Object.keys(vi.mocked(api.updateTask).mock.calls[0][1])).toEqual([
      "column_id",
    ]);
  });

  it("escolher a MESMA coluna não manda requisição", async () => {
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(await screen.findByTitle("Mudar de coluna"));
    fireEvent.click(await screen.findByRole("option", { name: "Backlog" }));

    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("⚠️ mover para coluna DONE RELÊ as filhas — a cascata mudou o banco", async () => {
    // O `complete_descendants` conclui a subárvore inteira no backend, e
    // NENHUMA das filhas vem na resposta do PATCH. Sem o refetch, a checklist
    // seguiria mostrando aberta uma subtarefa que já está concluída.
    const filha = task({
      id: "f1",
      title: "Filha",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-backlog",
    });
    const salva = task({ id: "pai", title: "Tarefa mãe", path: "pai" });
    vi.mocked(api.updateTask).mockResolvedValue({
      ...salva,
      column_id: "col-done",
      status: "COMPLETED",
    });
    montar([filha]);
    await screen.findByText("Filha");
    vi.mocked(api.listarFilhas).mockClear();

    fireEvent.click(await screen.findByTitle("Mudar de coluna"));
    fireEvent.click(await screen.findByRole("option", { name: "Concluído" }));

    await waitFor(() => {
      expect(api.listarFilhas).toHaveBeenCalledWith("pai");
    });
  });
});

// A linha da subtarefa mostra só dd/mm (é estreita); a hora vai no `title`.
describe("TaskDetail -- a hora da subtarefa vive no title", () => {
  it("subtarefa com hora leva data e hora no title; sem hora, só a data", async () => {
    montar([
      task({
        id: "f1",
        title: "Com hora",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        due_date: "2026-12-31",
        // `HH:MM:SS` como o backend manda -- ver o `dataHoraBR`.
        due_time: "18:00:00",
      }),
      task({
        id: "f2",
        title: "Sem hora",
        parent_task_id: "pai",
        path: "pai.f2",
        depth: 1,
        due_date: "2026-12-31",
      }),
    ]);
    await screen.findByText("Com hora");

    expect(screen.getAllByText("31/12").length).toBe(2);
    expect(screen.getByTitle("31/12/2026 18:00")).toBeTruthy();
    expect(screen.getByTitle("31/12/2026")).toBeTruthy();
  });
});

// A coluna na linha da subtarefa desfaz uma ambiguidade: a caixinha marca por
// semântica `DONE`, então CANCELADA e BACKLOG aparecem as duas desmarcadas.
describe("TaskDetail -- a coluna aparece na checklist", () => {
  it("a subtarefa mostra o nome da coluna em que está", async () => {
    montar([
      task({
        id: "f1",
        title: "Filha",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        column_id: "col-planejado",
      }),
    ]);
    await screen.findByText("Filha");
    expect(screen.getByTitle("Coluna: Planejado")).toBeTruthy();
  });

  it("⚠️ CANCELADA e BACKLOG são as duas desmarcadas -- e agora se distinguem", async () => {
    // `CANCELLED` é terminal mas NÃO é DONE, então a caixa fica vazia igual à
    // de uma tarefa que nem começou.
    const CANCELADO: Coluna = {
      id: "col-cancelado",
      name: "Cancelado",
      color: "var(--status-cancel-dot)",
      position: 6,
      semantic: "CANCELLED",
      notify_deadline: false,
      is_default_target: true,
      is_status_bridge: false,
    };
    // ⚠️ Só NESTE teste: uma quarta coluna na fixture compartilhada derrubaria
    // o teste de ordenação, que afirma exatamente três.
    vi.mocked(api.colunasDoQuadro).mockResolvedValue([...COLUNAS, CANCELADO]);

    montar([
      task({
        id: "f1", title: "Cancelada", parent_task_id: "pai",
        path: "pai.f1", depth: 1, column_id: "col-cancelado",
      }),
      task({
        id: "f2", title: "No backlog", parent_task_id: "pai",
        path: "pai.f2", depth: 1, column_id: "col-backlog",
      }),
    ]);
    await screen.findByText("Cancelada");

    // As duas caixas seguem desmarcadas -- isso NÃO mudou.
    const caixas = screen
      .getAllByRole("checkbox")
      .filter((c) => (c as HTMLInputElement).type === "checkbox");
    expect(caixas.every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    // O que mudou: dá para saber qual é qual.
    expect(screen.getByTitle("Coluna: Cancelado")).toBeTruthy();
    expect(screen.getByTitle("Coluna: Backlog")).toBeTruthy();
  });

  it("coluna desconhecida não desenha rótulo nenhum", async () => {
    // Subtarefa de outro quadro não está no mapa de colunas. Mesma regra do
    // `tone`: sem coluna, sem sinal -- e não um rótulo vazio ao lado da
    // prioridade.
    montar([
      task({
        id: "f1", title: "De outro quadro", parent_task_id: "pai",
        path: "pai.f1", depth: 1, column_id: "col-de-outro-quadro",
      }),
    ]);
    await screen.findByText("De outro quadro");
    expect(screen.queryByTitle(/^Coluna: /)).toBeNull();
  });
});
