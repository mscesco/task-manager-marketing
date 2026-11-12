/**
 * /arquivadas: o detalhe de uma subtarefa arquivada mostra o pai ("voltar"),
 * buscado sempre que o detalhe abre, uma chamada por detalhe.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import Arquivadas from "@/app/arquivadas/page";
import type { Member, Task } from "@/lib/api";
import { indiceDeColunas, type Coluna } from "@/lib/coluna";

import { ActiveTeamProvider } from "@/lib/useActiveTeam";

// Mock incompleto de next/navigation derruba a árvore com um erro que não fala
// da tela testada.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/arquivadas",
  useSearchParams: () => new URLSearchParams(),
}));

// AppShell fora do teste: ele busca sessão e times e monta o menu, e falha com
// erros que não falam desta tela. O mock fornece o contexto de time, porque o
// AppShell de verdade fornece: sem ele a tela espera o time para sempre (`active`
// `null` significa "ainda não sei").
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <ActiveTeamProvider
      value={{
        active: { kind: "team", teamId: TIME_DO_TESTE, fromUrl: true },
        search: `?time=${TIME_DO_TESTE}`,
        teamName: "Marketing",
        teams: [],
      }}
    >
      {children}
    </ActiveTeamProvider>
  ),
}));

/** O time que o `AppShell` falso diz estar ativo. */
const TIME_DO_TESTE = "time-do-teste";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listArchivedTasks: vi.fn(),
    // O badge de cada linha mostra o nome da coluna; sem este mock a chamada
    // vaza para o `fetch` do jsdom.
    quadroGeralComIndice: vi.fn(),
    listAllTasks: vi.fn(),
    listAllProjects: vi.fn(),
    listMembers: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
    getTask: vi.fn(),
    reactivateTask: vi.fn(),
    currentUser: vi.fn(),
    listComments: vi.fn(),
  };
});

const api = await import("@/lib/api");

const RAIZ = "team-raiz";
const ANA = "user-ana";

function task(over: Partial<Task> & { id: string; title: string }): Task {
  return {
    project_id: null,
    parent_task_id: null,
    team_id: RAIZ,
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    position: 0,
    depth: 0,
    path: over.id,
    // Obrigatórios em `Task`; não troque por `as Task` (esconde campo faltando).
    board_id: "board-geral",
    column_id: "col-backlog",
    can_delete: true,
    start_date: null,
    due_date: null,
    due_time: null,
    completed_at: null,
    terminal_since: null,
    created_by: ANA,
    is_archived: true,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    assignee_ids: [ANA],
    ...over,
  };
}

const PAI = task({ id: "pai-1", title: "Campanha de março" });
const SUB = task({
  id: "sub-1",
  title: "Peça para Instagram",
  parent_task_id: PAI.id,
  depth: 1,
});

const GERAL_ID = "board-geral";

const COLUNAS_GERAL: Coluna[] = [
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
    id: "col-progress",
    name: "Em Andamento",
    color: "var(--status-progress-dot)",
    position: 2,
    semantic: "IN_PROGRESS",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
];

/** Um quadro avulso, para o badge de tarefa que mora fora do geral. */
const QUADROS = [
  { id: GERAL_ID, name: "Quadro geral", colunas: COLUNAS_GERAL },
  {
    id: "board-campanhas",
    name: "Campanhas",
    colunas: [
      {
        id: "av-revisao",
        name: "Em Revisão",
        color: "var(--status-progress-dot)",
        position: 1,
        semantic: "IN_PROGRESS" as const,
        notify_deadline: true,
        is_default_target: false,
        is_status_bridge: false,
      },
    ],
  },
];

const MEMBROS: Member[] = [
  {
    id: ANA,
    workspace_id: "ws",
    name: "Ana",
    email: "ana@x.com",
    is_active: true,
    team_ids: [RAIZ],
  },
];

function montar(itens: Task[]) {
  vi.mocked(api.listArchivedTasks).mockResolvedValue({
    items: itens,
    total: itens.length,
    page: 1,
    size: 20,
  });
  vi.mocked(api.listAllTasks).mockResolvedValue({
    items: itens,
    total: itens.length,
    truncated: false,
  });
  vi.mocked(api.listAllProjects).mockResolvedValue({
    items: [],
    total: 0,
    truncated: false,
  });
  vi.mocked(api.quadroGeralComIndice).mockResolvedValue({
    colunas: COLUNAS_GERAL,
    indice: indiceDeColunas(QUADROS, GERAL_ID),
  });
  vi.mocked(api.listMembers).mockResolvedValue(MEMBROS);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(MEMBROS);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.getTask).mockResolvedValue(PAI);
  vi.mocked(api.currentUser).mockResolvedValue({
    id: ANA,
    name: "Ana",
    email: "ana@x.com",
    permissions: ["task.create", "task.update"],
  } as Awaited<ReturnType<typeof api.currentUser>>);
  vi.mocked(api.listComments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 50,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/arquivadas -- de onde veio esta subtarefa?", () => {
  it("subtarefa aberta da lista busca e mostra o pai", async () => {
    montar([SUB]);
    render(<Arquivadas />);
    const linha = await screen.findByText("Peça para Instagram");
    fireEvent.click(linha);

    await waitFor(() => {
      expect(api.getTask).toHaveBeenCalledWith(PAI.id);
    });
    // O nome do pai aparece na tela -- é o que faz a instrução
    // "desarquive a tarefa pai primeiro" ser seguível.
    await waitFor(() => {
      expect(screen.getAllByText(/Campanha de março/).length).toBeGreaterThan(
        0,
      );
    });
  });

  it("tarefa de TOPO não busca pai nenhum", async () => {
    // Uma chamada por detalhe aberto já é o teto; buscar pai de quem não tem
    // seria uma requisição por clique, de graça.
    montar([PAI]);
    render(<Arquivadas />);
    fireEvent.click(await screen.findByText("Campanha de março"));
    // O detalhe abriu quando o título aparece DUAS vezes (linha + detalhe).
    await waitFor(() => {
      expect(screen.getAllByText("Campanha de março").length).toBeGreaterThan(1);
    });
    expect(api.getTask).not.toHaveBeenCalled();
  });

  it("pai inacessível não quebra o detalhe", async () => {
    // Lente do usuário ou tarefa apagada: a subtarefa continua utilizável,
    // só fica sem o "voltar". Degrada em silêncio, como /tarefa/[id].
    montar([SUB]);
    vi.mocked(api.getTask).mockRejectedValue(new Error("403"));
    // Sem o `.catch`, a rejeição não derruba o React (o título segue na tela);
    // o espião torna a falha explícita em vez de depender do código de saída do runner.
    const naoTratadas: unknown[] = [];
    const vigia = (e: PromiseRejectionEvent) => {
      naoTratadas.push(e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", vigia);

    render(<Arquivadas />);
    fireEvent.click(await screen.findByText("Peça para Instagram"));
    await waitFor(() => {
      expect(api.getTask).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener("unhandledrejection", vigia);

    expect(naoTratadas).toEqual([]);
    // E o detalhe segue utilizável, só sem o "voltar".
    expect(screen.getAllByText("Peça para Instagram").length).toBeGreaterThan(
      0,
    );
  });
});

// `/arquivadas` lista o workspace inteiro com as colunas dos quadros que quem olha
// alcança: coluna desconhecida é o caso normal, e a reserva por status resolve.
describe("/arquivadas -- o badge sai da coluna", () => {
  it("mostra o nome da coluna, com reserva no rótulo do status", async () => {
    montar([
      // Par torto: pelo status o badge diria "Backlog".
      task({
        id: "a1",
        title: "Arquivada com coluna",
        status: "BACKLOG",
        column_id: "col-progress",
      }),
      // Coluna de outro quadro -> cai na reserva.
      task({
        id: "a2",
        title: "Arquivada sem coluna",
        status: "COMPLETED",
        column_id: "col-de-outro-quadro",
      }),
    ]);
    render(<Arquivadas />);

    expect(await screen.findByText("Em Andamento")).toBeTruthy();
    expect(screen.getByText("Concluído")).toBeTruthy();
    expect(screen.queryByText("Backlog")).toBeNull();
  });

  it("o badge diz o QUADRO e a coluna quando a tarefa mora fora do geral", async () => {
    montar([
      task({
        id: "a2",
        title: "Do Campanhas",
        board_id: "board-campanhas",
        column_id: "av-revisao",
      }),
    ]);

    render(<Arquivadas />);
    await screen.findByText("Do Campanhas");

    expect(screen.getByText("Campanhas · Em Revisão")).toBeTruthy();
  });
});

describe("/arquivadas -- encerrada em", () => {
  it("concluída mostra a conclusão; cancelada, a entrada na coluna terminal", async () => {
    montar([
      task({
        id: "c1",
        title: "Concluída",
        status: "COMPLETED",
        completed_at: "2026-03-10T15:00:00Z",
        terminal_since: "2026-03-12T15:00:00Z",
      }),
      task({
        id: "c2",
        title: "Cancelada",
        status: "CANCELLED",
        terminal_since: "2026-03-20T15:00:00Z",
      }),
    ]);
    render(<Arquivadas />);
    await screen.findByText("Cancelada");

    expect(screen.getByRole("columnheader", { name: "Encerrada em" })).toBeTruthy();
    const linha = (titulo: string) => screen.getByText(titulo).closest("tr")!;
    expect(linha("Concluída").textContent).toContain("10/03/2026");
    expect(linha("Concluída").textContent).not.toContain("12/03/2026");
    expect(linha("Cancelada").textContent).toContain("20/03/2026");
  });
});
