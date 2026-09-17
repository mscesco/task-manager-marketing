// Spec 053, fatia D -- seguidores no modal de CRIAR tarefa.
//
// O que se prende: o seguidor escolhido chega no ARGUMENTO de `createTask`
// (o corpo e o `createTaskCorpo.test.ts`), o campo nasce vazio (D6), e o 422
// dos seguidores e lido pelo `details.field` -- nao se confunde com o dos
// responsaveis.
//
// SABOTAGEM (medida): em `TaskModal.salvar`, apagar `watcher_ids: watcherIds`.
// Deve cair "o seguidor escolhido vai no createTask".

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import TaskModal from "@/components/TaskModal";
import { ApiError, type Member, type Task } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    createTask: vi.fn(),
    duplicateTask: vi.fn(),
    updateTask: vi.fn(),
    listProjects: vi.fn(),
    listMembers: vi.fn(),
    listMembersDoTime: vi.fn(),
    getRootTeamId: vi.fn(),
    colunasDoQuadro: vi.fn(),
  };
});

const api = await import("@/lib/api");

const RAIZ = "team-raiz";
const ANA = "u-ana";
const BRUNO = "u-bruno";
const CARLA = "u-carla";

function membro(id: string, name: string): Member {
  return {
    id,
    workspace_id: "ws",
    name,
    email: `${id}@x.com`,
    is_active: true,
    team_ids: [RAIZ],
  };
}

const TIME = [membro(ANA, "Ana"), membro(BRUNO, "Bruno"), membro(CARLA, "Carla")];

function task(over: Partial<Task> = {}): Task {
  // Literal completo, SEM `as` -- fixture com `as` cala o `tsc` sobre campo
  // que não existe.
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
    team_id: RAIZ,
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: ANA,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    assignee_ids: [],
    board_id: "board-geral",
    column_id: "col-backlog",
    // Spec 051, fatia A: o cadeado vem do servidor, em toda resposta.
    can_delete: true,
    ...over,
  };
}

function mocks() {
  vi.mocked(api.listMembers).mockResolvedValue(TIME);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(TIME);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.colunasDoQuadro).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
}


async function preencherECriar(escolherSeguidor: boolean) {
  mocks();
  render(<TaskModal open newTaskTeam={null} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Título"), {
    target: { value: "Tarefa nova" },
  });
  // Responsavel e obrigatorio: pela busca + Enter, como a pessoa real.
  fireEvent.click(await screen.findByLabelText("Designar responsável"));
  const buscaResp = await screen.findByPlaceholderText("Buscar pessoa…");
  fireEvent.change(buscaResp, { target: { value: "Ana" } });
  fireEvent.keyDown(buscaResp, { key: "Enter" });
  fireEvent.click(screen.getByLabelText("Designar responsável")); // fecha

  if (escolherSeguidor) {
    fireEvent.click(await screen.findByLabelText("Escolher seguidores"));
    const buscaSeg = await screen.findByPlaceholderText("Buscar pessoa…");
    fireEvent.change(buscaSeg, { target: { value: "Bruno" } });
    fireEvent.keyDown(buscaSeg, { key: "Enter" });
  }
  fireEvent.click(screen.getByText("Criar tarefa"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskModal -- seguidores na criação", () => {
  it("o campo nasce vazio (D6)", async () => {
    mocks();
    render(<TaskModal open newTaskTeam={null} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText("Ninguém segue ainda.")).toBeTruthy();
  });

  it("⚠️ o seguidor escolhido vai no createTask", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task({ id: "t-nova" }));
    await preencherECriar(true);
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(vi.mocked(api.createTask).mock.calls[0][0].watcher_ids).toEqual([BRUNO]);
  });

  it("sem escolha, vai lista vazia", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task({ id: "t-nova" }));
    await preencherECriar(false);
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(vi.mocked(api.createTask).mock.calls[0][0].watcher_ids).toEqual([]);
  });

  it("422 dos SEGUIDORES diz que e seguir, e nao designar", async () => {
    vi.mocked(api.createTask).mockRejectedValue(
      new ApiError(422, "x", "validation_error", {
        field: "watcher_ids",
        invalid_ids: [BRUNO],
      }),
    );
    await preencherECriar(true);
    expect(
      await screen.findByText(/Não foi possível pôr para seguir: Bruno/),
    ).toBeTruthy();
  });
});
