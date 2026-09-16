// Spec 052, fatia B -- links com nome: a fileira, o editor e o modal da tarefa.
//
// O que ele prende:
//   - a fileira mostra o NOME como link, em aba nova, com o endereço no title;
//   - o editor adiciona, remove, reordena e completa o https:// ao sair do campo;
//   - ⚠️ os erros só aparecem depois de tentar salvar;
//   - na CÓPIA não há editor (os links vão pelo servidor).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import EditorDeLinks from "@/components/EditorDeLinks";
import LinksDoItem from "@/components/LinksDoItem";
import TaskModal from "@/components/TaskModal";
import type { Member, Task } from "@/lib/api";
import { rascunhoDe, type RascunhoLink } from "@/lib/links";

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
    getTaskLinks: vi.fn(),
    putTaskLinks: vi.fn(),
  };
});

const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SALVOS = [
  { id: "l1", title: "Pasta principal", url: "https://drive.google.com/x" },
  { id: "l2", title: "Banco de imagens", url: "https://voleibrasil.media/" },
];

describe("LinksDoItem", () => {
  it("⭐ mostra o NOME como link, em aba nova, com o endereço no title", () => {
    render(<LinksDoItem links={SALVOS} rotulo="Links do projeto" />);
    const link = screen.getByRole("link", { name: /Pasta principal/ });
    expect(link.getAttribute("href")).toBe("https://drive.google.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("title")).toBe("https://drive.google.com/x");
    // O endereço NÃO aparece como texto -- só o nome.
    expect(screen.queryByText("https://drive.google.com/x")).toBeNull();
  });

  it("sem links, nada", () => {
    const { container } = render(<LinksDoItem links={[]} rotulo="Links" />);
    expect(container.innerHTML).toBe("");
  });
});

function EditorControlado({
  inicial,
  mostrarErros = false,
}: {
  inicial: RascunhoLink[];
  mostrarErros?: boolean;
}) {
  const [valor, setValor] = useState(inicial);
  return <EditorDeLinks valor={valor} onChange={setValor} mostrarErros={mostrarErros} />;
}

describe("EditorDeLinks", () => {
  it("adiciona uma linha e completa o https:// ao sair do endereço", () => {
    render(<EditorControlado inicial={[]} />);
    fireEvent.click(screen.getByText("Adicionar link"));
    const url = screen.getByLabelText("Endereço do link 1") as HTMLInputElement;
    fireEvent.change(url, { target: { value: "drive.google.com/abc" } });
    fireEvent.blur(url);
    expect(url.value).toBe("https://drive.google.com/abc");
  });

  it("remove e reordena", () => {
    render(<EditorControlado inicial={rascunhoDe(SALVOS)} />);
    fireEvent.click(screen.getByLabelText("Descer o link 1"));
    expect((screen.getByLabelText("Nome do link 1") as HTMLInputElement).value).toBe(
      "Banco de imagens",
    );
    fireEvent.click(screen.getByLabelText("Remover o link 1"));
    expect((screen.getByLabelText("Nome do link 1") as HTMLInputElement).value).toBe(
      "Pasta principal",
    );
    expect(screen.queryByLabelText("Nome do link 2")).toBeNull();
  });

  it("⚠️ erro só aparece depois de tentar salvar", () => {
    const semNome = [{ chave: "x", title: "", url: "https://a.com" }];
    const { rerender } = render(<EditorDeLinks valor={semNome} onChange={() => {}} mostrarErros={false} />);
    expect(screen.queryByText("Dê um nome ao link.")).toBeNull();
    rerender(<EditorDeLinks valor={semNome} onChange={() => {}} mostrarErros />);
    expect(screen.getByText("Dê um nome ao link.")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ modal

const RAIZ = "team-raiz";
const ANA = "u-ana";

function membro(id: string, name: string): Member {
  return { id, workspace_id: "ws", name, email: `${id}@x.com`, is_active: true, team_ids: [RAIZ] };
}

function task(over: Partial<Task> = {}): Task {
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
    can_delete: true,
    ...over,
  };
}

function mocks() {
  vi.mocked(api.listMembers).mockResolvedValue([membro(ANA, "Ana")]);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([membro(ANA, "Ana")]);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.colunasDoQuadro).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({ items: [], total: 0, page: 1, size: 100 });
  vi.mocked(api.getTaskLinks).mockResolvedValue(SALVOS);
  vi.mocked(api.putTaskLinks).mockResolvedValue(SALVOS);
}

describe("TaskModal -- links na cópia (Spec 052, fatia B)", () => {
  // ⚠️ OS DOIS TESTES DE "EDITAR" QUE MORAVAM AQUI foram para
  // `EdicaoNoLugar.test.tsx`: o modo editar saiu do modal na fatia D, e os
  // links de uma tarefa existente se editam no detalhe (`LinksEditaveis`).

  it("na cópia não há editor -- os links vão pelo servidor", async () => {
    mocks();
    render(
      <TaskModal
        open
        duplicarDe={task({ assignee_ids: [ANA] })}
        newTaskTeam={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(await screen.findByText("Os links da tarefa original vão junto na cópia.")).toBeTruthy();
    expect(screen.queryByText("Adicionar link")).toBeNull();
  });
});
