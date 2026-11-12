/**
 * `/minhas-tarefas`: teste de montagem. A tela não pinta nada até a lista E as
 * colunas chegarem, para não piscar concluídas que ninguém pediu.
 *
 * Fora daqui: drag-and-drop (jsdom não gera os eventos de ponteiro), aparência,
 * e a regra `colunasPadraoMinhasTarefas` (testada em `paridadeColuna.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import MinhasTarefasPage from "@/app/minhas-tarefas/page";
import type { Member, MyTaskItem, Project } from "@/lib/api";
import { indiceDeColunas, type Coluna } from "@/lib/coluna";

// ⚠️ Mock incompleto de next/navigation derruba a árvore com `invariant
// expected app router to be mounted`, um erro que não aponta a causa.
import { ActiveTeamProvider } from "@/lib/useActiveTeam";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/minhas-tarefas",
  useSearchParams: () => new URLSearchParams(),
}));

// AppShell fora do teste: ele busca sessão e times e monta o menu inteiro.
// ⚠️ O mock precisa fornecer o contexto de time: a tela espera o time ativo
// antes de buscar, e com `active: null` ("ainda não sei") carrega para sempre.
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

// `importOriginal`: TaskCard/TaskModal/TaskDetail importam outros exports de
// `@/lib/api`, e uma fábrica seca os deixaria `undefined`.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listAllMyAssignments: vi.fn(),
    quadroGeralComIndice: vi.fn(),
    listMembers: vi.fn(),
    getRootTeamId: vi.fn(),
    listAllProjects: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    currentUser: vi.fn(),
    listComments: vi.fn(),
    listMembersDoTime: vi.fn(),
  };
});

const api = await import("@/lib/api");

const RAIZ = "team-marketing";
const ANA = "user-ana";

/**
 * As colunas do quadro geral que os testes usam (a paridade com o backend
 * está em `paridadeColuna.test.ts`).
 */
const COLUNAS: Coluna[] = [
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
  {
    id: "col-done",
    name: "Concluído",
    color: "var(--status-done-dot)",
    position: 5,
    semantic: "DONE",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
  {
    id: "col-cancel",
    name: "Cancelado",
    color: "var(--status-cancel-dot)",
    position: 6,
    semantic: "CANCELLED",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
];

/**
 * Um quadro AVULSO, com uma coluna que nao existe no geral.
 *
 * ⚠️ `Em Revisão` é `IN_PROGRESS` e NÃO é alvo, então cai em `Em Andamento`
 * (coluna equivalente) e o card fica agrupado numa coluna com OUTRO nome: é o
 * caso que a tag existe para explicar.
 * ⚠️ `Aguardando cliente` tem `notify_deadline: false`: serve para provar que
 * o alerta de prazo le a coluna REAL da tarefa, e nao a equivalente.
 */
const COLUNAS_AVULSO: Coluna[] = [
  {
    id: "av-revisao",
    name: "Em Revisão",
    color: "var(--status-progress-dot)",
    position: 1,
    semantic: "IN_PROGRESS",
    notify_deadline: true,
    is_default_target: false,
    is_status_bridge: false,
  },
  {
    id: "av-espera",
    name: "Aguardando cliente",
    color: "var(--status-progress-dot)",
    position: 2,
    semantic: "IN_PROGRESS",
    notify_deadline: false,
    is_default_target: false,
    is_status_bridge: false,
  },
];

const GERAL_ID = "board-geral";
const QUADROS = [
  { id: GERAL_ID, name: "Quadro geral", colunas: COLUNAS },
  { id: "board-campanhas", name: "Campanhas", colunas: COLUNAS_AVULSO },
];

function item(
  over: Partial<MyTaskItem> & { id: string; title: string }
): MyTaskItem {
  return {
    workspace_id: "ws",
    project_id: null,
    parent_task_id: null,
    team_id: RAIZ,
    board_id: "board-geral",
    column_id: "col-progress",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    position: 0,
    depth: 0,
    path: over.id,
    start_date: null,
    due_date: null,
    completed_at: null,
    is_archived: false,
    created_by: ANA,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    relations: ["assignee"],
    assignee_ids: [ANA],
    parent_title: null,
    ...over,
  } as MyTaskItem;
}

const MEMBROS: Member[] = [
  {
    id: ANA,
    workspace_id: "ws",
    name: "Ana",
    email: "ana@x.com",
    is_active: true,
    team_ids: [RAIZ],
  } as Member,
];

/**
 * As chamadas que a tela dispara ao montar. `truncated` é configurável para o
 * teste do teto.
 */
function montarApi(
  itens: MyTaskItem[],
  opts: { truncated?: boolean; total?: number } = {}
) {
  vi.mocked(api.listAllMyAssignments).mockResolvedValue({
    items: itens,
    total: opts.total ?? itens.length,
    truncated: opts.truncated ?? false,
  } as Awaited<ReturnType<typeof api.listAllMyAssignments>>);
  vi.mocked(api.quadroGeralComIndice).mockResolvedValue({
    colunas: COLUNAS,
    indice: indiceDeColunas(QUADROS, GERAL_ID),
  });
  vi.mocked(api.listMembers).mockResolvedValue(MEMBROS);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.listAllProjects).mockResolvedValue({
    items: [] as Project[],
    total: 0,
    truncated: false,
  } as Awaited<ReturnType<typeof api.listAllProjects>>);
  vi.mocked(api.listTasks).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  } as Awaited<ReturnType<typeof api.listTasks>>);
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
  } as Awaited<ReturnType<typeof api.listComments>>);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(MEMBROS);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("minhas-tarefas -- fiacao da tela", () => {
  // ------------------------------------------------------------------ 1
  it("nao pinta tarefa nenhuma enquanto a lista nao chega", async () => {
    let resolver: (v: unknown) => void = () => {};
    const pendente = new Promise((r) => {
      resolver = r;
    });
    montarApi([]);
    vi.mocked(api.listAllMyAssignments).mockReturnValue(
      pendente as ReturnType<typeof api.listAllMyAssignments>
    );

    render(<MinhasTarefasPage />);

    expect(screen.getByRole("status", { name: /Carregando/i })).toBeTruthy();
    expect(screen.queryByText("Tarefa em andamento")).toBeNull();

    resolver({
      items: [item({ id: "t1", title: "Tarefa em andamento", status: "IN_PROGRESS" })],
      total: 1,
      truncated: false,
    });

    await waitFor(() => {
      expect(screen.getByText("Tarefa em andamento")).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ 1b
  it("nao pinta tarefa nenhuma enquanto as COLUNAS nao chegam", async () => {
    // A lista já chegou, as colunas não. Sem esperar, a tela pintaria sem
    // filtro e piscaria concluídas quando as colunas chegassem.
    let resolver: (v: unknown) => void = () => {};
    const pendente = new Promise((r) => {
      resolver = r;
    });
    montarApi([item({ id: "t1", title: "Tarefa qualquer" })]);
    vi.mocked(api.quadroGeralComIndice).mockReturnValue(
      pendente as ReturnType<typeof api.quadroGeralComIndice>
    );

    render(<MinhasTarefasPage />);

    // A lista resolve na hora; as colunas nao. A tela tem de segurar.
    await waitFor(() => {
      expect(screen.getByRole("status", { name: /Carregando/i })).toBeTruthy();
    });
    expect(screen.queryByText("Tarefa qualquer")).toBeNull();

    resolver({ colunas: COLUNAS, indice: indiceDeColunas(QUADROS, GERAL_ID) });

    await waitFor(() => {
      expect(screen.getByText("Tarefa qualquer")).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ 1c
  it("os chips de filtro vem da API, com o NOME da coluna", async () => {
    // Cai se os rótulos voltarem a sair de `STATUSES`, cravado no front.
    montarApi([item({ id: "t1", title: "Uma tarefa" })]);

    render(<MinhasTarefasPage />);
    await waitFor(() => {
      expect(screen.getByText("Uma tarefa")).toBeTruthy();
    });

    // ⚠️ Mira no BOTÃO: "Em Andamento" aparece também como rótulo da linha, e
    // `getByText` estouraria com "Found multiple elements".
    const chip = (nome: string) => screen.getByRole("button", { name: nome });

    // Os tres nomes da fixture, que NAO sao os 8 status do `STATUSES`.
    expect(chip("Em Andamento")).toBeTruthy();
    expect(chip("Cancelado")).toBeTruthy();
    expect(chip("Concluído")).toBeTruthy();

    // E o contrario: um rotulo que so existiria se a tela ainda lesse
    // `STATUSES` (a fixture nao tem coluna "Backlog").
    expect(screen.queryByRole("button", { name: "Backlog" })).toBeNull();
  });

  // ------------------------------------------------------------------ 2
  it("abre escondendo as CONCLUIDAS, e so elas", async () => {
    // ⚠️ Afirma os DOIS lados: a concluida some E as outras ficam. Um teste
    // que so afirmasse "nao aparece a concluida" passaria com a tela vazia.
    montarApi([
      item({ id: "t1", title: "Em andamento", status: "IN_PROGRESS", column_id: "col-progress" }),
      item({ id: "t2", title: "Ja concluida", status: "COMPLETED", column_id: "col-done" }),
      item({ id: "t3", title: "Cancelada", status: "CANCELLED", column_id: "col-cancel" }),
    ]);

    render(<MinhasTarefasPage />);

    await waitFor(() => {
      expect(screen.getByText("Em andamento")).toBeTruthy();
    });
    expect(screen.getByText("Cancelada")).toBeTruthy();
    expect(screen.queryByText("Ja concluida")).toBeNull();
  });

  // ------------------------------------------------------------------ 3
  it("o botao Todos religa as concluidas", async () => {
    // O padrão esconde, mas a pessoa consegue ver.
    montarApi([
      item({ id: "t1", title: "Em andamento", status: "IN_PROGRESS", column_id: "col-progress" }),
      item({ id: "t2", title: "Ja concluida", status: "COMPLETED", column_id: "col-done" }),
    ]);

    render(<MinhasTarefasPage />);
    await waitFor(() => {
      expect(screen.getByText("Em andamento")).toBeTruthy();
    });
    expect(screen.queryByText("Ja concluida")).toBeNull();

    fireEvent.click(screen.getByText("Todos"));

    await waitFor(() => {
      expect(screen.getByText("Ja concluida")).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ 4
  it("le /me/assignments, e nao a listagem geral de tarefas", async () => {
    // ⚠️ As duas rotas devolvem task e o componente importa as duas; trocar a
    // fonte daria uma tela plausível, cheia de tarefas que não são da pessoa.
    montarApi([item({ id: "t1", title: "Minha tarefa" })]);

    render(<MinhasTarefasPage />);
    await waitFor(() => {
      expect(screen.getByText("Minha tarefa")).toBeTruthy();
    });

    expect(vi.mocked(api.listAllMyAssignments)).toHaveBeenCalled();
    expect(vi.mocked(api.listTasks)).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ 5
  it("avisa quando a lista foi truncada pelo teto", async () => {
    // O número exibido é o TOTAL do backend, nao o tamanho da lista carregada -- por isso o
    // mock manda 250 com um item so.
    montarApi([item({ id: "t1", title: "Uma tarefa" })], {
      truncated: true,
      total: 250,
    });

    render(<MinhasTarefasPage />);
    await waitFor(() => {
      expect(screen.getByText("Uma tarefa")).toBeTruthy();
    });

    expect(screen.getByText("250")).toBeTruthy();
  });
});

// O kanban desta tela: desenho e agrupamento das colunas. O `onDragEnd` não
// roda em jsdom.
describe("minhas-tarefas -- o kanban le colunas da API", () => {
  async function abrirQuadro() {
    render(<MinhasTarefasPage />);
    await screen.findByRole("button", { name: "Quadro" });
    fireEvent.click(screen.getByRole("button", { name: "Quadro" }));
  }

  it("as colunas do kanban tem o NOME que veio da API", async () => {
    montarApi([
      item({ id: "t1", title: "Uma tarefa", column_id: "col-progress" }),
    ]);
    await abrirQuadro();

    // ⚠️ Na vista de QUADRO os chips de filtro somem, então "Em Andamento"
    // aparece UMA vez (na de lista seriam duas).
    await waitFor(() => {
      expect(screen.getAllByText("Em Andamento")).toHaveLength(1);
    });
    // Os nomes vem de `COLUNAS` (a fixture), e as tres estao desenhadas.
    expect(screen.getByText("Concluído")).toBeTruthy();
    expect(screen.getByText("Cancelado")).toBeTruthy();
    // A fixture tem tres; nenhuma outra coluna padrao aparece.
    expect(screen.queryByText("Bloqueado")).toBeNull();
    expect(screen.queryByText("Aprovação Externa")).toBeNull();
  });

  /**
   * Separa "lê coluna" de "lê status": a tarefa tem
   * `status: "COMPLETED"` e `column_id` de Em Andamento. Agrupando por status
   * ela cairia em Concluído.
   */
  it("agrupa o card pela COLUNA, mesmo com o status dizendo outra coisa", async () => {
    montarApi([
      item({
        id: "t1",
        title: "Card teimoso",
        status: "COMPLETED",
        column_id: "col-progress",
      }),
    ]);
    await abrirQuadro();

    const card = await screen.findByText("Card teimoso");
    // ⚠️ `[data-coluna]`, não seletor por estilo: o próprio título do card
    // tem `minWidth` e o `closest` o acharia.
    const coluna = card.closest("[data-coluna]");
    expect(coluna?.textContent).toContain("Em Andamento");
    expect(coluna?.textContent).not.toContain("Concluído");
  });

  /**
   * Esta tela junta tarefas de QUALQUER quadro e desenha as colunas do GERAL:
   * coluna fora do mapa vira contador, não some.
   */
  it("card em coluna desconhecida nao some em silencio", async () => {
    montarApi([
      item({ id: "t1", title: "Card normal", column_id: "col-progress" }),
      item({ id: "t2", title: "Card perdido", column_id: "col-de-outro-quadro" }),
    ]);
    await abrirQuadro();

    await screen.findByText("Card normal");
    expect(screen.queryByText("Card perdido")).toBeNull();
    expect(
      screen.getByText(/1 tarefa está em uma\s+coluna que não é deste quadro/)
    ).toBeTruthy();
  });
});

// Tarefa que mora em OUTRO quadro: sem tratamento ela some calada da lista.
describe("minhas-tarefas -- tarefa de outro quadro", () => {
  /** Uma tarefa que vive no quadro Campanhas, na coluna `Em Revisão`. */
  function tarefaAvulsa(over: Partial<MyTaskItem> = {}) {
    return item({
      id: "t-avulsa",
      title: "Tarefa do Campanhas",
      board_id: "board-campanhas",
      column_id: "av-revisao",
      ...over,
    });
  }

  it("⚠️ a tarefa de quadro avulso aparece na LISTA", async () => {
    // ⚠️ O filtro de coluna da lista guarda ids do quadro GERAL; o `column_id`
    // desta tarefa nunca está neles, e na lista não há contador que avise.
    montarApi([tarefaAvulsa()]);

    render(<MinhasTarefasPage />);

    expect(await screen.findByText("Tarefa do Campanhas")).toBeTruthy();
  });

  it("⚠️ a tag da lista diz o quadro E a coluna de origem", async () => {
    // As DUAS informacoes: o quadro responde "onde mora", a coluna responde
    // "por que este card esta agrupado em Em Andamento se a coluna dele chama
    // outra coisa".
    montarApi([tarefaAvulsa()]);

    render(<MinhasTarefasPage />);
    await screen.findByText("Tarefa do Campanhas");

    expect(screen.getByText("Campanhas · Em Revisão")).toBeTruthy();
  });

  it("⚠️ o card de quadro avulso e DESENHADO no kanban, e nao so contado", async () => {
    // `Em Revisão` é `IN_PROGRESS` sem alvo, então vai para a equivalente
    // `Em Andamento`, e não para o contador `foraDaColuna`.
    montarApi([tarefaAvulsa()]);

    render(<MinhasTarefasPage />);
    await screen.findByRole("button", { name: "Quadro" });
    fireEvent.click(screen.getByRole("button", { name: "Quadro" }));

    expect(await screen.findByText("Tarefa do Campanhas")).toBeTruthy();
    expect(screen.queryByText(/coluna que não é deste quadro/i)).toBeNull();
  });

  it("⚠️ a tag do card so aparece para tarefa de OUTRO quadro", async () => {
    // No kanban o cabecalho da coluna ja diz o nome. Repetir na tag e ruido --
    // a tag so vale quando responde o que o cabecalho nao responde.
    montarApi([
      tarefaAvulsa(),
      item({ id: "t-geral", title: "Tarefa do geral", column_id: "col-progress" }),
    ]);

    render(<MinhasTarefasPage />);
    await screen.findByRole("button", { name: "Quadro" });
    fireEvent.click(screen.getByRole("button", { name: "Quadro" }));
    await screen.findByText("Tarefa do geral");

    // A de outro quadro tem tag; o cabecalho "Em Andamento" continua UNICO.
    expect(screen.getByText("Campanhas · Em Revisão")).toBeTruthy();
    expect(screen.getAllByText("Em Andamento")).toHaveLength(1);
  });

  it("⚠️ o alerta de prazo sobrevive numa tarefa de outro quadro", async () => {
    // O alerta lê a coluna REAL da tarefa (`Em Revisão`, com
    // `notify_deadline: true`), mesmo ela não estando no quadro geral.
    montarApi([tarefaAvulsa({ due_date: "2020-01-01" })]);

    render(<MinhasTarefasPage />);
    await screen.findByText("Tarefa do Campanhas");

    // O que se afirma é que o selo de atraso existe. `getAll` só tolera mais
    // de um casamento; a lista agrupa por data, não em "Atrasadas".
    expect(screen.getAllByText(/atrasad/i).length).toBeGreaterThan(0);
  });

  it("⚠️ coluna com notify_deadline false NAO ganha alerta pela equivalente", async () => {
    // O espelho do anterior: `Aguardando cliente` não avisa prazo, mas a
    // equivalente dela no geral (`Em Andamento`) avisa.
    montarApi([
      tarefaAvulsa({ column_id: "av-espera", due_date: "2020-01-01" }),
    ]);

    render(<MinhasTarefasPage />);
    await screen.findByText("Tarefa do Campanhas");

    expect(screen.queryByText(/atrasad/i)).toBeNull();
  });
});

// ⚠️ Vazio é o estado de UM time: o aviso não pode substituir a barra, porque
// é nela que mora o seletor de time (a única porta de volta).
describe("Minhas tarefas -- vazia, a barra continua", () => {
  it("⚠️ sem tarefa no time, os controles seguem na tela", async () => {
    montarApi([]);
    render(<MinhasTarefasPage />);
    // O toggle mora na mesma barra que o seletor de time: se ele está aqui, a
    // barra sobreviveu ao vazio.
    expect(await screen.findByRole("button", { name: "Quadro" })).toBeTruthy();
  });

  it("e o vazio diz de QUAL time, em vez de \"você está em dia\"", async () => {
    // "Você está em dia" com a lista recortada é mentira: você pode ter vinte
    // tarefas no Marketing. O mock do `AppShell` diz que o time ativo é o
    // Marketing.
    montarApi([]);
    render(<MinhasTarefasPage />);
    expect(await screen.findByText("Nenhuma tarefa sua em Marketing")).toBeTruthy();
    expect(screen.queryByText("Você está em dia")).toBeNull();
  });
});
