// Spec 055, fatia C -- a coluna lateral do detalhe: comentários e atividade.
//
// O QUE ESTE ARQUIVO PRENDE:
//   - o alternador tem os DOIS lados, com contador nos dois (§9.3);
//   - a atividade é buscada AO ABRIR, e não ao clicar na aba -- senão o
//     contador só apareceria depois do primeiro clique, que é quando ele já
//     não serve para decidir se vale clicar;
//   - trocar de aba mostra as frases do histórico, e os comentários somem da
//     vista (é uma coluna só, com dois assuntos);
//   - "Mostrar mais" só aparece quando falta coisa, e busca a PÁGINA SEGUINTE;
//   - ⚠️ falha na atividade NÃO derruba o detalhe: a tarefa continua na tela.
//
// SABOTAGENS (medidas):
//   A. Em `TaskDetail`, buscar a atividade só quando `abaLateral` for
//      "atividade". Deve cair "o contador da atividade aparece sem clicar".
//   B. No `catch` da busca de atividade, chamar `setErro` (o erro do detalhe
//      inteiro) em vez de `setErroAtividade`. Deve cair "⚠️ atividade que
//      falha não derruba o detalhe".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import { AvisosProvider } from "@/components/Toasts";
import type { Coluna } from "@/lib/coluna";
import type { Comment, Task, TaskHistoryEvent } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    getTaskLinks: async () => [],
    colunasDoQuadro: vi.fn(),
    listarFilhas: vi.fn(),
    listComments: vi.fn(),
    listTaskHistory: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
  };
});

const api = await import("@/lib/api");

const EU = "u-eu";
const ANA = "u-ana";

const COLUNAS: Coluna[] = [
  {
    id: "col-backlog",
    name: "Backlog",
    color: "var(--status-backlog-dot)",
    position: 0,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
  {
    id: "col-andamento",
    name: "Em Andamento",
    color: "var(--status-progress-dot)",
    position: 1,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: false,
    is_status_bridge: false,
  },
];

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Banner da home",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    due_time: null,
    project_id: null,
    parent_task_id: null,
    team_id: "team-seo",
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: ANA,
    created_at: "2026-09-30T12:00:00Z",
    updated_at: "2026-09-30T12:00:00Z",
    assignee_ids: [],
    board_id: "board-seo",
    column_id: "col-backlog",
    can_delete: true,
    ...over,
  };
}

const COMENTARIO: Comment = {
  id: "c1",
  task_id: "t1",
  user_id: ANA,
  parent_comment_id: null,
  content: "consegue até sexta?",
  edited_at: null,
  created_at: "2026-09-30T12:00:00Z",
  is_deleted: false,
  reactions: [],
};

function evento(over: Partial<TaskHistoryEvent> = {}): TaskHistoryEvent {
  return {
    id: "h1",
    event_type: "created",
    field_name: null,
    old_value: null,
    new_value: null,
    event_metadata: null,
    user_id: ANA,
    created_at: "2026-09-30T12:00:00Z",
    ...over,
  };
}

function detalhe(t: Task = task()) {
  return (
    <AvisosProvider>
      <TaskDetail
        task={t}
        members={new Map([[ANA, { name: "Ana Souza" }]])}
        projects={new Map()}
        temVoltar={false}
        onVoltar={vi.fn()}
        onClose={vi.fn()}
        onDuplicar={vi.fn()}
        onAssigneesChange={vi.fn()}
        onAbrirSubtarefa={vi.fn()}
        onSubtaskUpsert={vi.fn()}
        onTaskMoved={vi.fn()}
        onExcluir={vi.fn()}
        mostrarArquivadas={false}
        membrosInativos={new Set()}
      />
    </AvisosProvider>
  );
}

function montar(t: Task = task()) {
  return render(detalhe(t));
}

/** Página 1 com um evento de 3; a página 2 é de quem chama. */
function paginaUmDeTres() {
  vi.mocked(api.listTaskHistory).mockImplementation(async (_id, p) =>
    p?.page === 1
      ? { items: [evento({ id: "h1" })], total: 3, page: 1, size: 20 }
      : new Promise(() => {}),
  );
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
  vi.mocked(api.listarFilhas).mockResolvedValue([]);
  vi.mocked(api.listComments).mockResolvedValue({
    items: [COMENTARIO],
    total: 1,
    page: 1,
    size: 100,
  });
  vi.mocked(api.listTaskHistory).mockResolvedValue({
    items: [
      evento({
        id: "h2",
        event_type: "updated",
        field_name: "column_id",
        old_value: { value: "col-backlog" },
        new_value: { value: "col-andamento" },
        created_at: "2026-09-30T13:00:00Z",
      }),
      evento({ id: "h1" }),
    ],
    total: 2,
    page: 1,
    size: 20,
  });
  vi.mocked(api.currentUser).mockResolvedValue({
    id: EU,
    name: "Eu Mesma",
    email: "eu@t.dev",
    must_change_password: false,
    roles: ["OPERATOR"],
    permissions: ["task.update"],
    org_role: null,
    teams: [],
  } as never);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([] as never);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [], total: 0, page: 1, size: 50,
  } as never);
  vi.mocked(api.getRootTeamId).mockResolvedValue(null as never);
});

// ⚠️ Explícito (web/AGENTS.md §11): sem isto o segundo render acha dois
// detalhes montados e `getByRole` estoura.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a coluna lateral", () => {
  it("tem os dois assuntos, e o contador da atividade aparece sem clicar", async () => {
    montar();
    const comentarios = await screen.findByRole("tab", { name: /Comentários/ });
    const atividade = await screen.findByRole("tab", { name: /Atividade/ });
    expect(comentarios).toBeTruthy();
    // ⚠️ O "2" vem da busca feita AO ABRIR. Buscar só ao clicar na aba daria
    // um contador que aparece depois de a pessoa já ter decidido clicar.
    await waitFor(() => expect(atividade.textContent).toContain("2"));
  });

  it("começa nos comentários", async () => {
    montar();
    expect(await screen.findByText("consegue até sexta?")).toBeTruthy();
    expect(screen.queryByText("moveu de Backlog para Em Andamento")).toBeNull();
  });

  it("trocar para Atividade mostra as frases, e esconde os comentários", async () => {
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));

    expect(
      await screen.findByText("moveu de Backlog para Em Andamento"),
    ).toBeTruthy();
    expect(screen.getByText("criou a tarefa")).toBeTruthy();
    // A coluna é uma só: o comentário sai da vista.
    expect(screen.queryByText("consegue até sexta?")).toBeNull();
  });

  it("o nome de quem fez aparece uma vez por gesto", async () => {
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    await screen.findByText("criou a tarefa");
    // Dois eventos, dois instantes diferentes -> dois grupos, dois nomes.
    expect(screen.getAllByText("Ana Souza").length).toBe(2);
  });
});

describe("mostrar mais", () => {
  it("não aparece quando já veio tudo", async () => {
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    await screen.findByText("criou a tarefa");
    expect(screen.queryByRole("button", { name: /Mostrar mais/ })).toBeNull();
  });

  it("aparece quando falta, e busca a página seguinte", async () => {
    paginaUmDeTres();
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));

    const botao = await screen.findByRole("button", { name: /Mostrar mais/ });
    expect(botao.textContent).toContain("2"); // faltam 2
    vi.mocked(api.listTaskHistory).mockResolvedValueOnce({
      items: [evento({ id: "h9", event_type: "archived" })],
      total: 3,
      page: 2,
      size: 20,
    });
    fireEvent.click(botao);

    await waitFor(() =>
      expect(vi.mocked(api.listTaskHistory).mock.calls.at(-1)?.[1]).toMatchObject({
        page: 2,
      }),
    );
    expect(await screen.findByText("arquivou a tarefa")).toBeTruthy();
  });

  it("⚠️ falhar NÃO apaga o que já estava, e o botão continua", async () => {
    // Revisão de 08/10: o erro do "Mostrar mais" usava o mesmo estado do
    // primeiro carregamento, e a lista inteira virava o aviso.
    paginaUmDeTres();
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    const botao = await screen.findByRole("button", { name: /Mostrar mais/ });
    vi.mocked(api.listTaskHistory).mockRejectedValueOnce(new Error("caiu"));
    fireEvent.click(botao);

    expect(
      await screen.findByText("Não consegui carregar o resto da atividade."),
    ).toBeTruthy();
    expect(screen.getByText("criou a tarefa")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mostrar mais/ })).toBeTruthy();
  });

  it("⚠️ a página que chega depois de trocar de tarefa é descartada", async () => {
    // Revisão de 08/10: abrir uma subtarefa no meio do "Mostrar mais"
    // pendurava a página 2 da tarefa ANTERIOR na lista da nova.
    paginaUmDeTres();
    let soltar: (v: unknown) => void = () => {};
    const { rerender } = montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    const botao = await screen.findByRole("button", { name: /Mostrar mais/ });
    vi.mocked(api.listTaskHistory).mockImplementationOnce(
      () => new Promise((r) => (soltar = r as (v: unknown) => void)) as never,
    );
    fireEvent.click(botao);

    vi.mocked(api.listTaskHistory).mockResolvedValue({
      items: [evento({ id: "h-t2" })],
      total: 1,
      page: 1,
      size: 20,
    });
    rerender(detalhe(task({ id: "t2", title: "Outra", path: "t2" })));
    await waitFor(() =>
      expect(vi.mocked(api.listTaskHistory).mock.calls.at(-1)?.[0]).toBe("t2"),
    );
    soltar({
      items: [evento({ id: "h9", event_type: "archived" })],
      total: 3,
      page: 2,
      size: 20,
    });
    await screen.findByText("criou a tarefa");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("arquivou a tarefa")).toBeNull();
  });
});

describe("a atividade não envelhece", () => {
  it("voltar para a aba relê a primeira página", async () => {
    // Revisão de 08/10: só carregava ao abrir a tarefa; o que se mudava com
    // o detalhe aberto não aparecia até reabrir.
    montar();
    const atividade = await screen.findByRole("tab", { name: /Atividade/ });
    await waitFor(() => expect(api.listTaskHistory).toHaveBeenCalledTimes(1));
    fireEvent.click(atividade);
    await waitFor(() => expect(api.listTaskHistory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.listTaskHistory).mock.calls[1]).toEqual([
      "t1",
      { page: 1, size: 20 },
    ]);
  });
});

describe("o campo de escrever", () => {
  it("⚠️ fica FORA da área que rola, e some na aba de atividade", async () => {
    // Com ele no fim da lista, comentar numa tarefa com vinte comentários
    // exigia rolar até o fim primeiro.
    montar();
    const caixa = await screen.findByPlaceholderText(/Escreva um comentário/);
    // A área que rola é marcada com `data-rolagem="lateral"` -- a classe
    // arbitrária do Tailwind não serve de seletor.
    expect(caixa.closest('[data-rolagem="lateral"]')).toBeNull();
    // E a lista de comentários ESTÁ lá dentro: é ela que rola.
    expect(
      screen.getByText("consegue até sexta?").closest('[data-rolagem="lateral"]'),
    ).not.toBeNull();

    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    expect(screen.queryByPlaceholderText(/Escreva um comentário/)).toBeNull();
  });
});

describe("o par que se anula", () => {
  it("⚠️ seguir e deixar de seguir em seguida não aparecem", async () => {
    vi.mocked(api.listTaskHistory).mockResolvedValue({
      items: [
        evento({
          id: "h3",
          event_type: "unwatched",
          event_metadata: { target_user_id: ANA, by_self: true },
          created_at: "2026-09-30T14:00:00Z",
        }),
        evento({
          id: "h2",
          event_type: "watched",
          event_metadata: { target_user_id: ANA, by_self: true },
          created_at: "2026-09-30T13:59:00Z",
        }),
        evento({ id: "h1" }),
      ],
      total: 3,
      page: 1,
      size: 20,
    });
    montar();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));

    expect(await screen.findByText("criou a tarefa")).toBeTruthy();
    expect(screen.queryByText("passou a seguir")).toBeNull();
    expect(screen.queryByText("deixou de seguir")).toBeNull();
  });
});

describe("quando a atividade falha", () => {
  it("⚠️ atividade que falha não derruba o detalhe", async () => {
    vi.mocked(api.listTaskHistory).mockRejectedValue(new Error("caiu"));
    montar();

    // A tarefa continua na tela, e o comentário também.
    expect(await screen.findByText("consegue até sexta?")).toBeTruthy();
    fireEvent.click(await screen.findByRole("tab", { name: /Atividade/ }));
    expect(
      await screen.findByText("Não consegui carregar a atividade."),
    ).toBeTruthy();
  });
});
