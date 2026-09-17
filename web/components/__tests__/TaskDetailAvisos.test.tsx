// O detalhe da tarefa AVISA quando uma escrita falha (17/09).
//
// ⚠️ O DEFEITO QUE ESTE ARQUIVO PRENDE: o `TaskDetail` guardava a mensagem de
// falha (responsável, prioridade, coluna, arquivar, excluir) num `erro` que
// NADA desenhava desde 30/07 -- a caixa saiu num redesenho. O clique falhava em
// silêncio. Nenhum portão via: `tsc` não reclama de estado gravado e não lido
// (só com `--noUnusedLocals`, que foi como apareceu).
//
// Agora a falha vai para a pilha de avisos do app, e este teste monta o
// `AvisosProvider` de verdade para ver o texto NA TELA.
//
// SABOTAGEM: em `excluir()` do `TaskDetail`, trocar `avisar(` por `void (`.
// Deve cair o primeiro teste.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import { AvisosProvider } from "@/components/Toasts";
import type { Coluna } from "@/lib/coluna";
import { ApiError, type Comment, type CurrentUser, type Task } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    getTaskLinks: async () => [],
    colunasDoQuadro: vi.fn(),
    listarFilhas: vi.fn(),
    listComments: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
    deleteTask: vi.fn(),
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
    <AvisosProvider>
    <TaskDetail
      task={task(over)}
      members={new Map([[OUTRA, { name: "Outra Pessoa" }]])}
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
    </AvisosProvider>,
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

describe("TaskDetail -- falha de escrita vira aviso", () => {
  it("⚠️ excluir recusado (403) mostra o motivo na tela", async () => {
    vi.mocked(api.deleteTask).mockRejectedValue(new ApiError(403, "proibido"));
    montar({ can_delete: true });

    fireEvent.click(await screen.findByText("Excluir"));
    // O botão de confirmar também se chama "Excluir": é o que sobra na tela.
    const confirmar = screen.getAllByText("Excluir").at(-1)!;
    fireEvent.click(confirmar);

    expect(
      await screen.findByText("Você não pode excluir esta tarefa."),
    ).toBeTruthy();
  });

  it("falha genérica também avisa, com o texto de reserva", async () => {
    vi.mocked(api.deleteTask).mockRejectedValue(new ApiError(500, "boom"));
    montar({ can_delete: true });

    fireEvent.click(await screen.findByText("Excluir"));
    fireEvent.click(screen.getAllByText("Excluir").at(-1)!);

    expect(await screen.findByText("Não consegui excluir a tarefa.")).toBeTruthy();
  });
});
