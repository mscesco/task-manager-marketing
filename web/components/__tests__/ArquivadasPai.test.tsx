/**
 * /arquivadas -- botão "voltar para o pai" (04/08).
 *
 * DOIS defeitos cobertos aqui, e o segundo só apareceu por causa do primeiro:
 *
 *   1. Abrindo uma subtarefa arquivada DIRETO da lista, não havia nenhuma
 *      indicação de qual era o pai. A lista é chapada e não mostra
 *      hierarquia, então a mensagem do desarquivar ("desarquive a tarefa pai
 *      primeiro") era uma caça ao tesouro.
 *
 *   2. ⚠️ A `pilha` desta tela NUNCA funcionou. `onAbrirSubtarefa` empilhava
 *      e chamava `abrirDetalhe`, que fazia `setPilha([])` logo depois -- o
 *      React agrupa os dois setters e o último vence. `temVoltar` era sempre
 *      false, inclusive navegando de dentro. O estado existia, era lido, e
 *      mentia. Nenhum portão pegava: não havia teste de componente nesta
 *      tela.
 *
 * O conserto trocou os dois caminhos por um só: busca o pai sempre que o
 * detalhe abre (mesmo padrão de /tarefa/[id], uma chamada por detalhe).
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

// ⚠️ O AppShell (importado por 13 paginas) usa `usePathname` pra marcar o
// item ativo do menu. Mock incompleto de next/navigation derruba a arvore
// inteira com um erro que nao fala de AppShell nenhum.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/arquivadas",
  useSearchParams: () => new URLSearchParams(),
}));

// ⚠️ AppShell fora do teste. Ele e importado por 13 paginas (nao existe
// `layout.tsx`), busca sessao, times e monta o menu inteiro -- arrastava meia
// aplicacao pra dentro de um teste sobre "de onde veio esta subtarefa", e
// falhava com erros que nao falam da tela testada ("myTeams is not
// iterable"). O que se quer medir aqui e a PAGINA.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listArchivedTasks: vi.fn(),
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
    due_date: null,
    completed_at: null,
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

const MEMBROS: Member[] = [
  {
    id: ANA,
    workspace_id: "ws",
    name: "Ana",
    email: "ana@x.com",
    is_active: true,
    team_id: RAIZ,
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
    await waitFor(() => {
      expect(api.listAllTasks).toHaveBeenCalled();
    });
    expect(api.getTask).not.toHaveBeenCalled();
  });

  it("pai inacessível não quebra o detalhe", async () => {
    // Lente do usuário ou tarefa apagada: a subtarefa continua utilizável,
    // só fica sem o "voltar". Degrada em silêncio, como /tarefa/[id].
    montar([SUB]);
    vi.mocked(api.getTask).mockRejectedValue(new Error("403"));
    // ⚠️ COMO ESTE TESTE FALHA. A assercao abaixo (o titulo continua na
    // tela) NAO e o que pega a sabotagem: ela continua verdadeira mesmo sem
    // o `.catch`, porque a rejeicao nao derruba o React. Quem pega e o
    // PROPRIO RUNNER: sem o `.catch`, `npm test` sai com codigo 1
    // ("Unhandled Rejection") mesmo com os 3 testes verdes. Medido em 04/08.
    // O espiao abaixo torna a falha explicita em vez de depender so disso.
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
    // E o detalhe segue utilizavel, so sem o "voltar".
    expect(screen.getAllByText("Peça para Instagram").length).toBeGreaterThan(
      0,
    );
  });
});
