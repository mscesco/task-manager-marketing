// Pedido de 26/10 -- a seta que recolhe as respostas de um comentário, e o
// comentário que a notificação aponta (`?comentario=`) abrindo e piscando.
//
// (O cenário -- mocks, tarefa e montagem -- é o de `TaskDetailEsc.test.tsx`.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Comment, CurrentUser, Task } from "@/lib/api";

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
  };
});

const api = await import("@/lib/api");

const EU = "user-eu";
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

const TASK: Task = {
  id: "t1",
  title: "KV da Black",
  description: "",
  status: "BACKLOG",
  priority: "MEDIUM",
  start_date: null,
  due_date: null,
  due_time: null,
  project_id: null,
  parent_task_id: null,
  team_id: "team-mkt",
  path: "t1",
  depth: 0,
  position: 0,
  completed_at: null,
  is_archived: false,
  created_by: OUTRA,
  created_at: "2026-10-22T12:00:00Z",
  updated_at: "2026-10-22T12:00:00Z",
  assignee_ids: [],
  board_id: "board-geral",
  column_id: "col-backlog",
  can_delete: true,
};

function comentario(id: string, content: string, parent: string | null = null): Comment {
  return {
    id,
    task_id: "t1",
    user_id: OUTRA,
    parent_comment_id: parent,
    content,
    edited_at: null,
    created_at: "2026-10-22T12:00:00Z",
    is_deleted: false,
    reactions: [],
  };
}

const COMENTARIOS = [
  comentario("c1", "comentário raiz"),
  comentario("r1", "primeira resposta", "c1"),
  comentario("r2", "segunda resposta", "c1"),
];

function montar(comentarioEmFoco: string | null = null) {
  return (
    <TaskDetail
      task={TASK}
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
      modo="pagina"
      comentarioEmFoco={comentarioEmFoco}
    />
  );
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
  vi.mocked(api.listarFilhas).mockResolvedValue([]);
  vi.mocked(api.listComments).mockResolvedValue({
    items: COMENTARIOS,
    total: COMENTARIOS.length,
    page: 1,
    size: 100,
  });
  vi.mocked(api.currentUser).mockResolvedValue({
    id: EU,
    name: "Eu",
    email: "eu@t.dev",
    must_change_password: false,
    roles: ["OPERATOR"],
    permissions: [],
    org_role: null,
    teams: [{ team_id: "team-mkt", role: "OPERATOR" }],
  } as unknown as CurrentUser);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({ items: [], total: 0, page: 1, size: 100 });
  vi.mocked(api.getRootTeamId).mockResolvedValue("team-mkt");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("respostas de um comentário", () => {
  it("a seta mostra quantas são, e recolhe e abre pelo botão", async () => {
    render(montar());
    const seta = await screen.findByRole("button", { name: "2 respostas" });
    expect(seta.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("primeira resposta")).toBeDefined();

    fireEvent.click(seta);
    expect(seta.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("primeira resposta")).toBeNull();
    // o comentário raiz continua; só as respostas somem
    expect(screen.getByText("comentário raiz")).toBeDefined();

    fireEvent.click(seta);
    expect(screen.getByText("segunda resposta")).toBeDefined();
  });
});

describe("comentário apontado pela notificação", () => {
  it("abre a thread recolhida e destaca a resposta", async () => {
    const { rerender } = render(montar());
    fireEvent.click(await screen.findByRole("button", { name: "2 respostas" }));
    expect(screen.queryByText("segunda resposta")).toBeNull();

    // o clique na notificação muda só o `?comentario=` da rota
    rerender(montar("r2"));
    const alvo = await screen.findByText("segunda resposta");
    expect(alvo.closest("[data-comment-id]")?.getAttribute("data-comment-id")).toBe("r2");
    expect(alvo.closest("[data-comment-id]")?.className).toContain("comentario-destaque");
    expect(
      screen.getByRole("button", { name: "2 respostas" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
