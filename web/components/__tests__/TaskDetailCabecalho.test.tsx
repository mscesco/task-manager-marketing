// Titulo longo no detalhe.
//
// O titulo vai ate DUAS linhas (era uma, com reticencias), e mora na coluna da
// esquerda: crescer nao pode empurrar os comentarios. Por isso, lado a lado, as
// acoes do topo (Seguir, compartilhar, "⋯", fechar) moram na LATERAL; empilhado,
// no cabecalho -- e nunca nos dois (seriam dois "Fechar").
//
// (O cenário -- mocks, tarefa e montagem -- é o de `TaskDetailEsc.test.tsx`.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Comment, CurrentUser, Task } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    // Sem isto a busca de links vai à rede, falha, e
    // o aviso "Não consegui carregar os links" (role=alert) entra na tela.
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

function montar(over: Partial<Task>, onClose = vi.fn()) {
  render(
    <TaskDetail
      task={task(over)}
      members={new Map([[OUTRA, { name: "Outra Pessoa" }]])}
      projects={new Map()}
      temVoltar={false}
      onVoltar={vi.fn()}
      onClose={onClose}
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

function larguraDe(px: number) {
  window.matchMedia = ((q: string) => ({
    matches: px >= 900,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const LONGO =
  "Aplicar a nova identidade visual nos e-mails da sequência de empregabilidade, " +
  "revisar os textos com o time de conteúdo e validar os links de parcelamento";

describe("cabeçalho do detalhe com título longo", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("o título vai até duas linhas, fora da lateral", () => {
    montar({ title: LONGO });
    const titulo = screen.getByRole("button", { name: LONGO });
    expect(titulo.className).toContain("line-clamp-2");
    expect(titulo.className).not.toContain("truncate");
    expect(titulo.closest("aside")).toBeNull();
  });

  it("lado a lado (900px ou mais): as ações moram na lateral", () => {
    larguraDe(1700);
    montar({ title: LONGO });
    const fechar = screen.getAllByRole("button", { name: "Fechar" });
    expect(fechar).toHaveLength(1);
    expect(fechar[0].closest("aside")).not.toBeNull();
  });

  it("empilhado (abaixo de 900px): as ações voltam para o cabeçalho", () => {
    larguraDe(375);
    montar({ title: LONGO });
    const fechar = screen.getAllByRole("button", { name: "Fechar" });
    expect(fechar).toHaveLength(1);
    expect(fechar[0].closest("aside")).toBeNull();
  });
});
