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
import { indiceDeColunas, type Coluna } from "@/lib/coluna";

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
    // ⚠️ Fatia 4c-2: o badge de cada linha mostra o NOME da coluna. Sem este
    // mock a chamada real vaza para o `fetch` do jsdom.
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
    // ⚠️ Spec 036, fatia 3: `board_id`/`column_id` viraram obrigatorios em
    // `Task`. Um valor qualquer serve aqui -- este arquivo nao testa quadro --,
    // mas eles TEM de existir, senao o `tsc` recusa a fixture. Nao troque por
    // `as Task`: foi exatamente um `as` que escondeu este buraco por horas em
    // 10/08, no `minhasTarefas.test.tsx`.
    board_id: "board-geral",
    column_id: "col-backlog",
    start_date: null,
    due_date: null,
    due_time: null,
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

// =====================================================================
// Fatia 4c-2 -- o badge da linha mostra o nome da COLUNA.
//
// ⚠️ A RESERVA IMPORTA MAIS AQUI que nas outras telas: `/arquivadas` lista o
// workspace inteiro e as colunas vem do quadro GERAL, entao tarefa arquivada
// de um quadro de subtime cai na reserva por natureza -- nao por defeito.
// =====================================================================
describe("arquivadas -- o badge sai da coluna (fatia 4c-2)", () => {
  it("mostra o nome da coluna, com reserva no rótulo do status", async () => {
    montar([
      // ⚠️ PAR TORTO: status BACKLOG, coluna Em Andamento. Pelo status o badge
      // diria "Backlog".
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
});

// =====================================================================
// FATIA 5b-5b -- o badge de coluna de `/arquivadas`.
//
// ⚠️ ELE JA TEM UM GUARDIAO -- o describe "o badge sai da coluna (fatia 4c-2)"
// logo acima, que tranca o nome da coluna E a reserva por status. Medido: a
// sabotagem I derruba os DOIS blocos. Este aqui acrescenta o que a 4c-2 nao
// tinha como testar, porque nao existia: o NOME DO QUADRO no rotulo.
//
// ⚠️ ESTA TELA E O UNICO LUGAR ONDE "NAO SEI QUAL COLUNA" E NORMAL. Ela lista
// o workspace inteiro PAGINADO; a tarefa pode viver num quadro fora do alcance
// de quem olha, ou apagado. Por isso `rotuloDeColuna` devolve `null` e a
// reserva por status resolve -- e por isso a reserva precisa de teste.
//
// SABOTAGENS (medidas):
//   H. Em `arquivadas/page.tsx`, trocar
//          rotuloDaColuna={rotuloDeColuna(indice?.get(t.column_id))}
//      por
//          rotuloDaColuna={indice?.get(t.column_id)?.coluna.name ?? null}
//      -- ou seja, o nome da coluna sem o nome do quadro. Cai
//      "o badge diz o QUADRO e a coluna quando a tarefa mora fora do geral".
//   I. Trocar o `??` da reserva por `rotuloDaColuna ?? ""`. Cai
//      "coluna desconhecida cai na reserva por status".
// =====================================================================
describe("/arquivadas -- o badge de coluna (fatia 5b-5b)", () => {
  it("tarefa do quadro geral mostra so o nome da coluna", async () => {
    montar([task({ id: "a1", title: "Antiga", column_id: "col-progress" })]);

    render(<Arquivadas />);
    await screen.findByText("Antiga");

    expect(screen.getByText("Em Andamento")).toBeTruthy();
  });

  it("⚠️ o badge diz o QUADRO e a coluna quando a tarefa mora fora do geral", async () => {
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

  it("⚠️ coluna desconhecida cai na reserva por status", async () => {
    // ⚠️ O CASO NORMAL DESTA TELA, e nao um defeito: o quadro da tarefa nao
    // veio na lista de quem olha. `status` da fixture e `BACKLOG`.
    montar([
      task({
        id: "a3",
        title: "De quadro que nao veio",
        board_id: "board-sumido",
        column_id: "col-fantasma",
      }),
    ]);

    render(<Arquivadas />);
    await screen.findByText("De quadro que nao veio");

    expect(screen.getByText("Backlog")).toBeTruthy();
  });
});
