// Spec 051, fatia A -- o "Excluir" da tarefa e a moderação de comentário vêm da
// TAREFA (`can_delete`), e não de `me.permissions`.
//
// ⚠️ O CASO QUE ESTE ARQUIVO PRENDE: quem é gerente no Marketing e operador no
// Comercial tem `task.delete` (no Marketing) e VÊ a tarefa do Comercial (é
// operador lá). A tela perguntava `me.permissions.includes("task.delete")` --
// "em algum lugar" -- e desenhava Excluir e a lixeira do comentário alheio numa
// tarefa em que o servidor recusa as duas. O `/auth/me` diz "o que", nunca
// "onde"; quem sabe "onde" é o servidor, no `TaskResponse`.
//
// ⚠️ POR ISSO O `me` DE TODOS OS TESTES TEM `task.delete`: é a permissão
// "em algum lugar" que enganava a tela. O que muda de um teste para o outro é
// só o `can_delete` da tarefa.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Comment, CurrentUser, Task } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    colunasDoQuadro: vi.fn(),
    listarFilhas: vi.fn(),
    listComments: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
  };
});

const api = await import("@/lib/api");

const EU = "user-duas-arvores";
const OUTRA = "user-outra";

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
];

function task(over: Partial<Task> = {}): Task {
  // Literal completo, SEM `as`.
  return {
    id: "t1",
    title: "Tarefa do Comercial",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    due_time: null,
    project_id: null,
    parent_task_id: null,
    team_id: "team-comercial",
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: OUTRA,
    created_at: "2026-09-16T12:00:00Z",
    updated_at: "2026-09-16T12:00:00Z",
    assignee_ids: [],
    board_id: "board-geral",
    column_id: "col-backlog",
    can_delete: true,
    ...over,
  };
}

const COMENTARIO_ALHEIO: Comment = {
  id: "c1",
  task_id: "t1",
  user_id: OUTRA,
  parent_comment_id: null,
  content: "comentário de outra pessoa",
  edited_at: null,
  created_at: "2026-09-16T12:00:00Z",
  is_deleted: false,
  reactions: [],
};

function montar(over: Partial<Task>) {
  render(
    <TaskDetail
      task={task(over)}
      members={new Map([[OUTRA, { name: "Outra Pessoa" }]])}
      projects={new Map()}
      temVoltar={false}
      onVoltar={vi.fn()}
      onClose={vi.fn()}
      onEditar={vi.fn()}
      onDuplicar={vi.fn()}
      onAssigneesChange={vi.fn()}
      onAbrirSubtarefa={vi.fn()}
      onSubtaskUpsert={vi.fn()}
      onTaskMoved={vi.fn()}
      onExcluir={vi.fn()}
      mostrarArquivadas={false}
      membrosInativos={new Set()}
    />,
  );
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
  vi.mocked(api.listarFilhas).mockResolvedValue([]);
  vi.mocked(api.listComments).mockResolvedValue({
    items: [COMENTARIO_ALHEIO],
    total: 1,
    page: 1,
    size: 100,
  });
  vi.mocked(api.currentUser).mockResolvedValue({
    id: EU,
    name: "Duas Árvores",
    email: "duas@t.dev",
    must_change_password: false,
    roles: ["MANAGER", "OPERATOR"],
    // ⚠️ A permissão "em algum lugar" que enganava a tela.
    permissions: ["task.create", "task.update", "task.delete"],
    org_role: null,
    teams: [
      { team_id: "team-marketing", role: "MANAGER" },
      { team_id: "team-comercial", role: "OPERATOR" },
    ],
  } as unknown as CurrentUser);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.getRootTeamId).mockResolvedValue("team-comercial");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDetail -- o cadeado vem da tarefa (Spec 051, fatia A)", () => {
  it("⚠️ `can_delete: false`: sem Excluir e sem lixeira no comentário alheio -- com `task.delete` no /auth/me", async () => {
    montar({ can_delete: false });
    // O comentário carregou (e com ele o `me`): a partir daqui a ausência vale.
    expect(await screen.findByText("comentário de outra pessoa")).toBeTruthy();
    expect(await screen.findByText("Copiar link")).toBeTruthy();

    expect(screen.queryByText("Excluir")).toBeNull();
    expect(screen.queryByLabelText("Apagar comentário")).toBeNull();
  });

  it("`can_delete: true`: Excluir e a lixeira do comentário alheio aparecem", async () => {
    montar({ can_delete: true });
    expect(await screen.findByText("comentário de outra pessoa")).toBeTruthy();

    expect(await screen.findByText("Excluir")).toBeTruthy();
    expect(await screen.findByLabelText("Apagar comentário")).toBeTruthy();
  });
});
