/**
 * Board: testes de montagem (de onde a tela lê, o que espera antes de pintar,
 * o que entrega ao card). Arraste não é exercitável em jsdom; regra fica em `lib/`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import Board from "@/components/Board";
import type { Member, Project, Quadro, Task, Team } from "@/lib/api";

// `importOriginal`: outros componentes importam vários exports de `@/lib/api`,
// e uma fábrica seca os deixaria `undefined`.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listAllTasks: vi.fn(),
    // O `TaskDetail` busca as próprias filhas; sem mock cairia em `fetch`.
    listarFilhas: vi.fn(),
    listAllProjects: vi.fn(),
    listMembers: vi.fn(),
    listSubteams: vi.fn(),
    getRootTeamId: vi.fn(),
    // Sem este mock `quadros` fica `null` e a tela não sai de "Carregando tarefas…".
    listBoards: vi.fn(),
    // Teste que concluir uma edição de colunas precisa de `mockResolvedValue`.
    aplicarLoteDeColunas: vi.fn(),
    updateTask: vi.fn(),
    createTask: vi.fn(),
    duplicateTask: vi.fn(),
    // O "Duplicar" do TaskDetail exige `task.create` em `me`.
    currentUser: vi.fn(),
    listComments: vi.fn(),
    // O TaskModal filtra responsáveis por alcance; lista vazia trava o Salvar.
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
  };
});

const api = await import("@/lib/api");

const QUADRO_ID = "board-geral";

/**
 * Só as colunas que os testes usam (a paridade com o backend está em
 * `paridadeColuna.test.ts`). `col-backlog` é o `column_id` padrão de `task()`:
 * trocar um sem o outro joga todos os cards em "fora da coluna".
 */
const QUADRO: Quadro = {
  id: QUADRO_ID,
  name: "Quadro geral",
  team_id: "team-marketing",
  is_default: true,
  colunas: [
    {
      id: "col-backlog",
      name: "Backlog",
      color: "var(--status-backlog-dot)",
      position: 0,
      semantic: "OPEN",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: true,
    },
    {
      id: "col-progress",
      name: "Em Andamento",
      color: "var(--status-progress-dot)",
      position: 2,
      semantic: "IN_PROGRESS",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: true,
    },
    {
      id: "col-done",
      name: "Concluído",
      color: "var(--status-done-dot)",
      position: 5,
      semantic: "DONE",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: true,
    },
  ],
};

const RAIZ = "team-marketing";
const CRM = "team-crm";
const ANA = "user-ana";

// Fixtures: tarefa com team_id do CRM dentro de projeto do Marketing (raiz).
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
    board_id: QUADRO_ID,
    column_id: "col-backlog",
    can_delete: true,
    start_date: null,
    due_date: null,
    due_time: null,
    completed_at: null,
    terminal_since: null,
    created_by: ANA,
    is_archived: false,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    assignee_ids: [ANA],
    ...over,
  };
}

function project(id: string, team_id: string | null): Project {
  return {
    id,
    title: `Projeto ${id}`,
    description: "",
    status: "ACTIVE" as Project["status"],
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    completed_at: null,
    team_id,
    created_by: ANA,
    created_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
    can_update: true,
    can_delete: true,
  };
}

const MEMBROS: Member[] = [
  {
    id: ANA,
    workspace_id: "ws",
    name: "Ana",
    email: "ana@x.com",
    is_active: true,
    team_ids: [CRM],
  },
];

const SUBTIMES: Team[] = [
  { id: CRM, name: "CRM e Automação", parent_team_id: RAIZ } as Team,
];

/** Monta as respostas da API. `projetos` fica configurável por teste. */
function montarApi(tasks: Task[], projetos: Project[]) {
  vi.mocked(api.listAllTasks).mockResolvedValue({
    items: tasks,
    total: tasks.length,
    truncated: false,
  });
  // Filtra do mesmo conjunto que o quadro recebe.
  vi.mocked(api.listarFilhas).mockImplementation(async (parentId) =>
    tasks.filter((t) => t.parent_task_id === parentId)
  );
  vi.mocked(api.listAllProjects).mockResolvedValue({
    items: projetos,
    total: projetos.length,
    truncated: false,
  });
  vi.mocked(api.listBoards).mockResolvedValue([QUADRO]);
  vi.mocked(api.listMembers).mockResolvedValue(MEMBROS);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(MEMBROS);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.listSubteams).mockResolvedValue(SUBTIMES);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
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

/** O card do quadro, a partir do título. */
function card(titulo: string): HTMLElement {
  const t = screen.getByText(titulo);
  // `closest("[data-card]")`: não depende de quantos níveis há até a raiz do card.
  const c = t.closest("[data-card]");
  if (!c) throw new Error(`card sem container: ${titulo}`);
  return c as HTMLElement;
}

function pillDe(titulo: string): string | null {
  const c = within(card(titulo));
  const interna = c.queryByText("Interna");
  const compartilhada = c.queryByText("Compartilhada");
  if (interna) return "Interna";
  if (compartilhada) return "Compartilhada";
  return null;
}

// Sem `globals`, o auto-cleanup do @testing-library não se registra.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/quadro/team-crm");
});

describe("Board -- quadro de subtime, pill de escopo", () => {
  /** Quem enxerga o projeto enxerga a tarefa: o card não pode dizer "Interna". */
  it("time do subtime MAS projeto da raiz -> Compartilhada", async () => {
    montarApi(
      [
        task({
          id: "t2",
          title: "Pipeline HubSpot",
          team_id: CRM,
          project_id: "p-mkt",
        }),
      ],
      [project("p-mkt", RAIZ)]
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Pipeline HubSpot");
    expect(pillDe("Pipeline HubSpot")).toBe("Compartilhada");
  });

  // Pessoa em mais de um subtime: ramo da lente em que a tarefa da raiz aparece
  // porque o responsável é do subtime (`pertenceAoSubtime`).

  const SEO = "team-seo";

  it("⚠️ tarefa da raiz aparece na lente porque a responsavel esta em DOIS subtimes", async () => {
    // A redatora em SEO e em CRM.
    montarApi(
      [
        task({
          id: "t6",
          title: "Texto do lançamento",
          team_id: RAIZ,
          assignee_ids: [ANA],
        }),
      ],
      []
    );
    vi.mocked(api.listMembers).mockResolvedValue([
      { ...MEMBROS[0], team_ids: [SEO, CRM] },
    ]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    expect(await screen.findByText("Texto do lançamento")).toBeTruthy();
  });

  it("⚠️ e a lente NAO vaza: responsavel so de subtime alheio nao entra", async () => {
    // O outro lado: impede `includes` de virar `length > 0`.
    montarApi(
      [
        task({
          id: "t7",
          title: "Coisa do SEO",
          team_id: RAIZ,
          assignee_ids: [ANA],
        }),
      ],
      []
    );
    vi.mocked(api.listMembers).mockResolvedValue([
      { ...MEMBROS[0], team_ids: [SEO] },
    ]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    // Espera o quadro montar antes de afirmar ausência.
    await screen.findByRole("button", { name: /Filtros/ });
    expect(screen.queryByText("Coisa do SEO")).toBeNull();
  });
});

describe("Board -- guardas de carregamento", () => {
  /** Pintar antes dos projetos faria toda pill piscar. */
  it("nao pinta card antes de os PROJETOS responderem", async () => {
    let liberar!: (v: {
      items: Project[];
      total: number;
      truncated: boolean;
    }) => void;
    montarApi(
      [
        task({
          id: "t6",
          title: "Leads inbound",
          team_id: CRM,
          project_id: "p-mkt",
        }),
      ],
      []
    );
    vi.mocked(api.listAllProjects).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await waitFor(() => {
      expect(screen.getByRole("status", { name: /Carregando tarefas/ })).toBeTruthy();
    });
    expect(screen.queryByText("Leads inbound")).toBeNull();

    liberar({ items: [project("p-mkt", RAIZ)], total: 1, truncated: false });
    await screen.findByText("Leads inbound");
    // Quando pinta, já pinta com a pill certa.
    expect(pillDe("Leads inbound")).toBe("Compartilhada");
  });

  /** `touch-action: none` impediria rolar a coluna com o dedo. */
  it("o card nao prende o gesto de rolar", async () => {
    montarApi([task({ id: "t8", title: "Card no toque", team_id: CRM })], []);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Card no toque");
    // O alvo do arraste é quem embrulha o card (o `aria-roledescription` do dnd-kit).
    const arrastavel = card("Card no toque").closest("[aria-roledescription]") as HTMLElement;
    expect(arrastavel.style.touchAction).toBe("manipulation");
  });

  /** A flag de projetos vira true no `.finally`, senão a falha trava em "Carregando". */
  it("projetos FALHANDO nao travam o quadro", async () => {
    montarApi(
      [task({ id: "t7", title: "Tarefa avulsa", team_id: CRM })],
      []
    );
    vi.mocked(api.listAllProjects).mockRejectedValue(new Error("500"));

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa avulsa");
    expect(pillDe("Tarefa avulsa")).toBe("Interna");
  });
});

describe("Board -- filtro de responsável (multi-seleção, UNIÃO)", () => {
  const BEATRIZ = "user-beatriz";
  const CLARA = "user-clara";

  const EQUIPE: Member[] = [
    { id: BEATRIZ, workspace_id: "ws", name: "Beatriz", email: "b@x.com", is_active: true, team_ids: [CRM] },
    { id: CLARA, workspace_id: "ws", name: "Clara", email: "c@x.com", is_active: true, team_ids: [CRM] },
  ];

  /** Três tarefas: só Beatriz, só Clara, e uma sem ninguém. */
  function montarEquipe() {
    montarApi(
      [
        task({ id: "b1", title: "Tarefa da Beatriz", team_id: CRM, assignee_ids: [BEATRIZ] }),
        task({ id: "c1", title: "Tarefa da Clara", team_id: CRM, assignee_ids: [CLARA] }),
        task({ id: "n1", title: "Tarefa de ninguém", team_id: CRM, assignee_ids: [] }),
      ],
      []
    );
    vi.mocked(api.listMembers).mockResolvedValue(EQUIPE);
  }

  function abrirPainel() {
    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
  }

  function marcar(nome: string) {
    fireEvent.click(screen.getByLabelText(nome));
  }

  /** União: duas marcadas mostram as tarefas de cada uma. */
  it("UNIÃO: duas marcadas mostram as tarefas de CADA uma", async () => {
    montarEquipe();
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    abrirPainel();
    marcar("Beatriz");
    marcar("Clara");

    expect(screen.getByText("Tarefa da Beatriz")).toBeTruthy();
    expect(screen.getByText("Tarefa da Clara")).toBeTruthy();
    // Quem não tem nenhuma das duas continua fora.
    expect(screen.queryByText("Tarefa de ninguém")).toBeNull();
  });

  it("desmarcar volta ao estado anterior", async () => {
    montarEquipe();
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    abrirPainel();
    marcar("Beatriz");
    expect(screen.queryByText("Tarefa da Clara")).toBeNull();
    marcar("Beatriz");
    expect(screen.getByText("Tarefa da Clara")).toBeTruthy();
  });

  it("duas pessoas contam como UM filtro, não dois", async () => {
    montarEquipe();
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    abrirPainel();
    marcar("Beatriz");
    marcar("Clara");
    // A pastilha agrega: "Responsáveis: Beatriz +1", uma só.
    expect(screen.getByText(/Respons[áa]veis: Beatriz \+1/)).toBeTruthy();
    expect(screen.queryByText(/Respons[áa]vel: Clara/)).toBeNull();
  });

  it("herança por raiz: designação em SUBTAREFA mantém o card da raiz", async () => {
    montarApi(
      [
        task({ id: "r1", title: "Raiz sem responsável", team_id: CRM, assignee_ids: [] }),
        task({
          id: "s1",
          title: "Subtarefa da Beatriz",
          team_id: CRM,
          parent_task_id: "r1",
          depth: 1,
          assignee_ids: [BEATRIZ],
        }),
      ],
      []
    );
    vi.mocked(api.listMembers).mockResolvedValue(EQUIPE);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Raiz sem responsável");
    abrirPainel();
    marcar("Beatriz");
    expect(screen.getByText("Raiz sem responsável")).toBeTruthy();
  });
});

describe("Board -- depois de duplicar, abre a CÓPIA", () => {
  /**
   * Depois de duplicar, o detalhe abre a cópia. Cópia de subtarefa não vira
   * card, então sem isso ela parece ter sumido.
   */
  it("o detalhe passa a mostrar a cópia, não a origem", async () => {
    const ORIGEM = task({ id: "o1", title: "Tarefa original", team_id: CRM });
    montarApi([ORIGEM], []);
    // A cópia é subtarefa de pai desconhecido: não vira card nem entra na
    // checklist, então o título só aparece se o detalhe estiver nela.
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...task({
        id: "c1",
        title: "Cópia de Tarefa original",
        team_id: CRM,
        parent_task_id: "outro-pai",
        depth: 1,
      }),
      skipped_assignees: [],
      promoted_to_root: false,
    });
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa original");

    fireEvent.click(screen.getByText("Tarefa original"));
    // Duplicar mora no "⋯" do cabeçalho.
    fireEvent.click(await screen.findByRole("button", { name: "Mais ações" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicar" }));

    await screen.findByText("Duplicar tarefa");
    // Dois botões "Duplicar": o do detalhe é o único com `title`. O do modal só
    // perde o `title` depois do pré-preenchimento, um render depois.
    const salvar = await waitFor(() => {
      const b = screen
        .getAllByRole("button", { name: /^Duplicar$/ })
        .find((x) => !x.getAttribute("title"));
      if (!b) throw new Error("botão Duplicar do modal não encontrado");
      return b;
    });
    fireEvent.click(salvar);

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Cópia de Tarefa original").length).toBeGreaterThan(0);
    });
  });
});

describe("Board -- depois de duplicar, a CÓPIA aparece com as subtarefas", () => {
  /**
   * O backend copia a subárvore; depois de duplicar, a checklist da cópia tem
   * de mostrar as filhas criadas lá.
   */
  it("a checklist da cópia mostra as subtarefas criadas no backend", async () => {
    const ORIGEM = task({ id: "o1", title: "Tarefa original", team_id: CRM });
    const FILHA = task({
      id: "f1",
      title: "Passo um",
      team_id: CRM,
      parent_task_id: "o1",
      depth: 1,
    });
    const COPIA = task({ id: "c1", title: "Cópia de Tarefa original", team_id: CRM });
    const FILHA_DA_COPIA = task({
      id: "cf1",
      title: "Passo um",
      team_id: CRM,
      parent_task_id: "c1",
      depth: 1,
    });

    montarApi([ORIGEM, FILHA], []);
    // 1ª chamada: antes de duplicar. As seguintes já trazem a cópia e a filha.
    vi.mocked(api.listAllTasks)
      .mockResolvedValueOnce({ items: [ORIGEM, FILHA], total: 2, truncated: false })
      .mockResolvedValue({
        items: [ORIGEM, FILHA, COPIA, FILHA_DA_COPIA],
        total: 4,
        truncated: false,
      });
    // Depois de duplicar, a checklist da cópia vem desta busca.
    vi.mocked(api.listarFilhas).mockImplementation(async (parentId) =>
      [ORIGEM, FILHA, COPIA, FILHA_DA_COPIA].filter(
        (t) => t.parent_task_id === parentId
      )
    );
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...COPIA,
      skipped_assignees: [],
      promoted_to_root: false,
    });

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa original");

    fireEvent.click(screen.getByText("Tarefa original"));
    // Duplicar mora no "⋯" do cabeçalho.
    fireEvent.click(await screen.findByRole("button", { name: "Mais ações" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicar" }));

    await screen.findByText("Duplicar tarefa");
    await screen.findByText("Levar as subtarefas (1 diretas)");

    // O do modal só perde o `title` depois do pré-preenchimento.
    const salvar = await waitFor(() => {
      const b = screen
        .getAllByRole("button", { name: /^Duplicar$/ })
        .find((x) => !x.getAttribute("title"));
      if (!b) throw new Error("botão Duplicar do modal não encontrado");
      return b;
    });
    fireEvent.click(salvar);

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    await screen.findAllByText("Cópia de Tarefa original");

    // "Passo um" não vira card e a origem não está aberta: só a checklist da cópia o mostra.
    await waitFor(() => {
      expect(screen.getAllByText("Passo um").length).toBeGreaterThan(0);
    });
  });
});

describe("Board -- busca por título alcança as SUBTAREFAS", () => {
  /** Regra em `lib/filtrosQuadro:raizesQueCasamBusca`; aqui, que o Board a usa. */
  it("digitar o título de uma subtarefa mantém o card da tarefa de topo", async () => {
    montarApi(
      [
        task({ id: "r1", title: "Campanha de matrícula", team_id: CRM }),
        task({
          id: "s1",
          title: "Roteiro do vídeo",
          team_id: CRM,
          parent_task_id: "r1",
          depth: 1,
        }),
        task({ id: "r2", title: "Newsletter de julho", team_id: CRM }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha de matrícula");

    fireEvent.change(screen.getByPlaceholderText("Buscar por título…"), {
      target: { value: "roteiro do video" },
    });

    // A raiz da subtarefa que casou continua no quadro...
    expect(screen.getByText("Campanha de matrícula")).toBeTruthy();
    // ...e a que não tem nada a ver, não.
    expect(screen.queryByText("Newsletter de julho")).toBeNull();
    // A subtarefa não vira card.
    expect(screen.queryByText("Roteiro do vídeo")).toBeNull();
  });
});

// O quadro desenha as colunas da API, não a lista fixa de status.
// Arrastar continua sem cobertura (jsdom).
describe("Board -- as colunas vem da API", () => {
  it("desenha o nome das colunas do quadro, e nao os rotulos de status", async () => {
    montarApi([task({ id: "c1", title: "Post do blog" })], []);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Post do blog");

    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Em Andamento")).toBeTruthy();
    expect(screen.getByText("Concluído")).toBeTruthy();
    // As outras colunas padrão não aparecem: a lista não vem de `STATUSES`.
    expect(screen.queryByText("Bloqueado")).toBeNull();
    expect(screen.queryByText("Aprovação Externa")).toBeNull();
  });

  /** Agrupa pela coluna: status COMPLETED com `column_id` de Backlog cai em Backlog. */
  it("agrupa o card pela COLUNA, mesmo quando o status diz outra coisa", async () => {
    montarApi(
      [
        task({
          id: "c2",
          title: "Card teimoso",
          status: "COMPLETED",
          column_id: "col-backlog",
        }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    const card = await screen.findByText("Card teimoso");

    const colunaBacklog = screen.getByText("Backlog").closest("div")
      ?.parentElement;
    expect(colunaBacklog?.textContent).toContain("Card teimoso");
    expect(card).toBeTruthy();
  });

  /** Card de coluna fora deste quadro não aparece, e a tela diz isso. */
  it("card em coluna desconhecida nao some em silencio", async () => {
    montarApi(
      [
        task({ id: "c3", title: "Card normal" }),
        task({ id: "c4", title: "Card perdido", column_id: "col-de-outro-quadro" }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Card normal");

    expect(screen.queryByText("Card perdido")).toBeNull();
    expect(
      screen.getByText(/1 tarefa está em\s+uma coluna que não é deste quadro/)
    ).toBeTruthy();
  });

  /** Sem as colunas não há kanban: espera os quadros. */
  it("nao pinta card antes de os QUADROS responderem", async () => {
    let liberar!: (v: Quadro[]) => void;
    montarApi([task({ id: "c5", title: "Aguardando quadro" })], []);
    vi.mocked(api.listBoards).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await waitFor(() => {
      expect(screen.getByRole("status", { name: /Carregando tarefas/ })).toBeTruthy();
    });
    expect(screen.queryByText("Aguardando quadro")).toBeNull();

    liberar([QUADRO]);
    await screen.findByText("Aguardando quadro");
  });

  /** `listBoards` falhando não pode deixar `quadros` em `null`. */
  it("quadros FALHANDO nao travam a tela em Carregando", async () => {
    montarApi([task({ id: "c6", title: "Sem quadro nenhum" })], []);
    vi.mocked(api.listBoards).mockRejectedValue(new Error("500"));

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    // Sem coluna não há card, mas a tela responde e o contador avisa.
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /Carregando tarefas/ })).toBeNull();
    });
    expect(screen.queryByText("Sem quadro nenhum")).toBeNull();
  });
});

describe("Board -- o card decide pela coluna", () => {
  /**
   * `pararEhNoticia` exige `IN_PROGRESS` E `notify_deadline`: coluna ativa sem
   * cobrança de prazo não ganha selo. Quadro próprio para não mexer no `QUADRO`.
   */
  it("coluna que nao cobra prazo nao ganha selo de parada", async () => {
    const BLOQUEADO = {
      id: "col-blocked",
      name: "Bloqueado",
      color: "var(--status-blocked-dot)",
      position: 7,
      semantic: "IN_PROGRESS" as const,
      notify_deadline: false,
      is_default_target: false,
      is_status_bridge: false,
    };
    montarApi(
      [
        task({
          id: "c7",
          title: "Parada faz tempo",
          column_id: "col-progress",
          updated_at: "2026-01-01T12:00:00Z",
        }),
        task({
          id: "c8",
          title: "Travada faz tempo",
          column_id: "col-blocked",
          updated_at: "2026-01-01T12:00:00Z",
        }),
      ],
      []
    );
    vi.mocked(api.listBoards).mockResolvedValue([
      { ...QUADRO, colunas: [...QUADRO.colunas, BLOQUEADO] },
    ]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Parada faz tempo");

    expect(screen.getAllByText(/Parada há \d+ d/).length).toBe(1);
    // ...e a de "Bloqueado" não, com o mesmo `status` e `updated_at`.
    const cardTravada = screen.getByText("Travada faz tempo").closest("div")
      ?.parentElement;
    expect(cardTravada?.textContent).not.toMatch(/Parada há/);
  });
});

// O quadro sai do `board_id` das tarefas, não da flag `is_default`.
describe("Board -- o quadro sai das TAREFAS, nao da flag de padrão", () => {
  const INTERNO: Quadro = {
    id: "board-seo",
    name: "Quadro do SEO",
    team_id: CRM,
    is_default: false,
    colunas: [
      {
        id: "seo-fazer",
        name: "A escrever",
        color: "#7C3AED",
        position: 0,
        semantic: "OPEN",
        notify_deadline: true,
        is_default_target: true,
        is_status_bridge: false,
      },
      {
        id: "seo-revisar",
        name: "Em revisão de SEO",
        color: "#2563EB",
        position: 1,
        semantic: "IN_PROGRESS",
        notify_deadline: true,
        is_default_target: false,
        is_status_bridge: false,
      },
    ],
  };

  it("desenha as colunas do quadro em que as tarefas VIVEM", async () => {
    montarApi(
      [
        task({
          id: "s1",
          title: "Pauta de agosto",
          board_id: INTERNO.id,
          column_id: "seo-fazer",
        }),
      ],
      []
    );
    // O padrão vem primeiro: escolher por `is_default` desenharia as colunas erradas.
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO, INTERNO]);

    // Modo projeto: atravessa quadros, e o lote é a única pista das colunas.
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} projectId="proj-1" title="Nome do Projeto" />);
    await screen.findByText("Pauta de agosto");

    expect(screen.getByText("A escrever")).toBeTruthy();
    expect(screen.getByText("Em revisão de SEO")).toBeTruthy();
    // As colunas do geral não aparecem.
    expect(screen.queryByText("Backlog")).toBeNull();
    expect(screen.queryByText("Em Andamento")).toBeNull();
    // O quadro de projeto não pergunta a raiz.
    expect(api.getRootTeamId).not.toHaveBeenCalled();
  });

  it("⚠️ o QUADRO GERAL não adivinha pelo lote", async () => {
    // Todas as tarefas no quadro extra da raiz: o geral não desenha as colunas
    // dele nem as tarefas dele.
    montarApi(
      [
        task({
          id: "s1",
          title: "Pauta de agosto",
          board_id: INTERNO.id,
          column_id: "seo-fazer",
        }),
      ],
      []
    );
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO, INTERNO]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} title="Quadro geral" />);

    // Estado vazio: a tarefa do extra vem da API e some no filtro.
    expect(await screen.findByText("Nenhuma tarefa ainda")).toBeTruthy();
    expect(screen.queryByText("A escrever")).toBeNull();
    expect(screen.queryByText("Pauta de agosto")).toBeNull();
  });
});

// Checklist e prazo leem a coluna, não `status`.
describe("Board -- checklist e prazo leem a coluna", () => {
  // A contagem de subtarefas vem do backend; o card mostra o número que veio.
  it("o card mostra o contador agregado que veio do backend", async () => {
    montarApi(
      [
        task({
          id: "p1",
          title: "Campanha com filhas",
          subtask_total: 1,
          subtask_done: 1,
        }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha com filhas");

    expect(screen.getByTitle("1 de 1 subtarefas concluídas")).toBeTruthy();
  });

  it("o agregado GANHA de qualquer filha que ainda venha na lista", async () => {
    // Par torto de propósito: agregado 0/1 com uma filha na coluna de conclusão.
    // Se o front voltar a derivar, conta diferente e o teste cai.
    montarApi(
      [
        task({
          id: "p1",
          title: "Campanha com filhas",
          subtask_total: 1,
          subtask_done: 0,
        }),
        task({
          id: "f1",
          title: "Filha concluída",
          parent_task_id: "p1",
          path: "p1.f1",
          depth: 1,
          status: "BACKLOG",
          column_id: "col-done",
        }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha com filhas");

    expect(screen.getByTitle("0 de 1 subtarefas concluídas")).toBeTruthy();
  });

  /** Prazo vencido em coluna de conclusão não conta como atrasada. */
  it("tarefa em coluna de conclusão não conta como atrasada", async () => {
    montarApi(
      [
        // A diferença é só a coluna; o `status` das duas é BACKLOG.
        task({ id: "a1", title: "Atrasada de verdade", due_date: "2020-01-01" }),
        task({
          id: "a2",
          title: "Entregue mas vencida",
          due_date: "2020-01-01",
          column_id: "col-done",
        }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Atrasada de verdade");

    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    fireEvent.change(screen.getByLabelText("Prazo"), {
      target: { value: "atrasadas" },
    });

    expect(screen.getByText("Atrasada de verdade")).toBeTruthy();
    expect(screen.queryByText("Entregue mas vencida")).toBeNull();
  });
});

// O card mostra a hora do prazo, junto da cor que ela decide.
describe("Board -- o card diz a hora do prazo", () => {
  it("com hora, o card mostra data E hora; sem hora, so a data", async () => {
    montarApi(
      [
        task({
          id: "h1",
          title: "Com hora marcada",
          due_date: "2026-12-31",
          // `HH:MM:SS`, como o backend devolve.
          due_time: "18:00:00",
        }),
        task({ id: "h2", title: "Sem hora", due_date: "2026-12-31" }),
      ],
      []
    );
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Com hora marcada");

    expect(within(card("Com hora marcada")).getByText("31/12/2026 18:00")).toBeTruthy();
    // Sem hora, a data fica limpa.
    expect(within(card("Sem hora")).getByText("31/12/2026")).toBeTruthy();
  });
});

// A lente só mostra o Quadro geral. Sem o filtro, a tarefa de outro quadro
// some sem erro (só o contador de "fora da coluna" acusa).
describe("Board -- a lente so mostra o Quadro geral", () => {
  const OUTRO_QUADRO = "board-campanhas";

  it("⚠️ tarefa de quadro extra da RAIZ nao entra na lente do subtime", async () => {
    // Passaria no filtro antigo: `team_id === rootId` e a responsável é do CRM.
    montarApi(
      [
        task({ id: "t-geral", title: "Do quadro geral", team_id: RAIZ }),
        task({
          id: "t-extra",
          title: "Do quadro extra",
          team_id: RAIZ,
          board_id: OUTRO_QUADRO,
          column_id: "outra-col",
        }),
      ],
      []
    );

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Do quadro geral");

    expect(screen.queryByText("Do quadro extra")).toBeNull();
    // Esta é a asserção que discrimina: sem o filtro o card também some, mas
    // cai no aviso de "fora da coluna".
    expect(screen.queryByText(/coluna que não é deste quadro/i)).toBeNull();
  });

  it("⚠️ tarefa INTERNA do subtime em quadro avulso tambem nao entra", async () => {
    // O quadro avulso do subtime tem tela própria; não entra na lente.
    montarApi(
      [
        task({ id: "t-interna", title: "Interna no geral", team_id: CRM }),
        task({
          id: "t-avulsa",
          title: "Interna no avulso",
          team_id: CRM,
          board_id: OUTRO_QUADRO,
          column_id: "outra-col",
        }),
      ],
      []
    );

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Interna no geral");

    expect(screen.queryByText("Interna no avulso")).toBeNull();
    // O aviso separa a regra certa da errada.
    expect(screen.queryByText(/coluna que não é deste quadro/i)).toBeNull();
  });
});

// Quadro avulso (`boardId`): o quadro vem pedido, não do lote. Quadro vazio
// é o caso principal: o lote vazio cairia no padrão.
describe("Board -- quadro avulso", () => {
  const AVULSO = "board-campanhas";

  /** As colunas do avulso tem nomes que NAO existem no geral. */
  const COLUNAS_AVULSO = [
    {
      id: "av-backlog",
      name: "Backlog",
      color: "var(--status-backlog-dot)",
      position: 0,
      semantic: "OPEN" as const,
      notify_deadline: true,
      is_default_target: true,
      // Colunas base do avulso têm ponte: ler `is_status_bridge` sem `is_default`
      // sumiria com o "x" delas.
      is_status_bridge: true,
    },
    {
      id: "av-revisao",
      name: "Em Revisão",
      color: "var(--status-progress-dot)",
      position: 1,
      semantic: "IN_PROGRESS" as const,
      notify_deadline: true,
      is_default_target: true,
      // Idem: coluna base com ponte.
      is_status_bridge: true,
    },
  ];

  function comAvulso(tasks: Task[]) {
    montarApi(tasks, []);
    vi.mocked(api.listBoards).mockResolvedValue([
      QUADRO,
      {
        id: AVULSO,
        name: "Campanhas",
        team_id: CRM,
        is_default: false,
        colunas: COLUNAS_AVULSO,
      },
    ]);
  }

  it("⚠️ quadro VAZIO desenha as colunas DELE, e nao as do geral", async () => {
    // Todo quadro nasce vazio.
    comAvulso([]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId={AVULSO} title="Quadro · Campanhas" />);

    expect(await screen.findByText("Em Revisão")).toBeTruthy();
    // "Bloqueado" so existe no Quadro geral.
    expect(screen.queryByText("Bloqueado")).toBeNull();
  });

  it("⚠️ mostra SO as tarefas daquele quadro", async () => {
    comAvulso([
      task({
        id: "t-avulsa",
        title: "Do Campanhas",
        team_id: CRM,
        board_id: AVULSO,
        column_id: "av-revisao",
      }),
      task({ id: "t-geral", title: "Do geral", team_id: RAIZ }),
    ]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId={AVULSO} title="Quadro · Campanhas" />);

    expect(await screen.findByText("Do Campanhas")).toBeTruthy();
    // Sem o filtro por `board_id`, a do geral cairia em `foraDaColuna`.
    expect(screen.queryByText("Do geral")).toBeNull();
    expect(screen.queryByText(/coluna que não é deste quadro/i)).toBeNull();
  });

  it("⚠️ o modal de nova tarefa diz em qual quadro ela vai nascer", async () => {
    // Mostrar em qual quadro se cria.
    comAvulso([]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId={AVULSO} title="Quadro · Campanhas" />);
    fireEvent.click(await screen.findByText("+ Nova tarefa"));

    // Um nó de texto só (ver `TaskModal`).
    expect(await screen.findByText("no quadro Campanhas")).toBeTruthy();
  });

  /**
   * O payload ao criar tarefa num quadro avulso. `board_id` e `team_id` são
   * opcionais no backend, então perdê-los não dá erro: só cria no lugar errado.
   */
  async function criarTarefaPeloQuadro() {
    vi.mocked(api.createTask).mockResolvedValue(
      task({
        id: "t-nova",
        title: "Tarefa nova",
        team_id: CRM,
        board_id: AVULSO,
        column_id: "av-backlog",
      })
    );

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId={AVULSO} title="Quadro · Campanhas" />);
    fireEvent.click(await screen.findByText("+ Nova tarefa"));
    fireEvent.change(await screen.findByLabelText("Título"), {
      target: { value: "Tarefa nova" },
    });
    // Responsável é obrigatório; a caixa só existe com o popover aberto.
    fireEvent.click(await screen.findByLabelText("Designar responsável"));
    // Pela busca: o índice de checkbox pegaria outro controle do Board.
    const busca = await screen.findByPlaceholderText("Buscar pessoa…");
    fireEvent.change(busca, { target: { value: "Ana" } });
    fireEvent.keyDown(busca, { key: "Enter" });
    fireEvent.click(screen.getByText("Criar tarefa"));
    await waitFor(() => expect(vi.mocked(api.createTask)).toHaveBeenCalled());
    return vi.mocked(api.createTask).mock.calls[0][0];
  }

  // Modo de edição de colunas: lápis, barra e cards travados. O arraste de
  // cabeçalho não roda em jsdom (as setas usam `comOrdem`, testada à parte).

  it("⚠️ o lapis so aparece para quem pode editar colunas", async () => {
    // Sem permissão, toda ação daria 403.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId={AVULSO} title="Campanhas" />);
    expect(await screen.findByText("Campanhas")).toBeTruthy();
    expect(screen.queryByLabelText("Editar colunas")).toBeNull();

    cleanup();
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    expect(await screen.findByLabelText("Editar colunas")).toBeTruthy();
  });

  it("⚠️ o lapis APARECE no Quadro geral, sem boardId", async () => {
    // O Quadro geral é desenhado sem `boardId`; a guarda não pode depender dele.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} title="Quadro geral" podeEditarColunas podeApagarColunas />);
    expect(await screen.findByLabelText("Editar colunas")).toBeTruthy();
  });

  it("⚠️ a LENTE de subtime NAO ganha lapis, mesmo com permissao", async () => {
    // A lente não mostra editar nem apagar: ausente, não desabilitado.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} subteamId={CRM} title="Quadro · CRM" podeEditarColunas podeApagarColunas />);
    expect(await screen.findByText("Quadro · CRM")).toBeTruthy();
    expect(screen.queryByLabelText("Editar colunas")).toBeNull();
  });

  it("⚠️ no Quadro geral a coluna com PONTE nao oferece apagar", async () => {
    // Coluna-ponte do geral não ganha "x" (derrubaria o lote no "Concluir edição").
    comAvulso([]);
    render(<Board acoesDoQuadro={null} title="Quadro geral" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    expect(screen.queryByLabelText("Apagar Em Andamento")).toBeNull();
    expect(screen.getAllByText("não pode ser apagada").length).toBeGreaterThan(0);
  });

  it("⚠️ nome repetido barra no CONCLUIR, sem gastar pedido nenhum", async () => {
    // O backend recusa o lote inteiro com nome repetido; barrar aqui preserva a edição.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));

    fireEvent.click(screen.getByText("Em Revisão"));
    const campo = screen.getByLabelText("Nome da coluna Em Revisão");
    fireEvent.change(campo, { target: { value: "Backlog" } });
    fireEvent.blur(campo);

    fireEvent.click(screen.getByText("Concluir edição"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Duas colunas ficariam com o nome/)).toBeTruthy();
    // E nenhum pedido saiu.
    expect(api.aplicarLoteDeColunas).not.toHaveBeenCalled();
    expect(screen.getByText("Modo edição")).toBeTruthy();
  });

  it("⚠️ ao entrar no modo, a area de colunas ganha o fundo esmaecido", async () => {
    // O fundo do modo é token, não hex (hex não inverte no tema escuro).
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    const lapis = await screen.findByLabelText("Editar colunas");

    expect(document.querySelector('[style*="--edicao-fundo"]')).toBeNull();

    fireEvent.click(lapis);
    expect(screen.getByText("Modo edição")).toBeTruthy();
    expect(document.querySelector('[style*="--edicao-fundo"]')).toBeTruthy();
  });

  it("⚠️ sair do modo devolve o quadro ao normal", async () => {
    // Sair do modo tira o esmaecido.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    expect(document.querySelector('[style*="--edicao-fundo"]')).toBeTruthy();

    fireEvent.click(screen.getByText("Sair"));

    expect(screen.queryByText("Modo edição")).toBeNull();
    expect(document.querySelector('[style*="--edicao-fundo"]')).toBeNull();
  });

  it("⚠️ o modo de edicao NAO cai no estado vazio -- desenha as colunas", async () => {
    // Com zero tarefa visível (vazio ou filtro), o modo de edição ainda mostra
    // as colunas, e não o estado vazio.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} title="Quadro geral" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    expect(screen.queryByText("Nenhuma tarefa ainda")).toBeNull();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("⚠️ no quadro AVULSO a coluna com ponte CONTINUA apagavel", async () => {
    // Colunas base do avulso também têm ponte; a trava depende de `is_default`.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    expect(screen.getByLabelText("Apagar Em Revisão")).toBeTruthy();
  });

  it("⚠️ o modo de edicao TROCA a barra, e nao acrescenta itens", async () => {
    // Busca, filtros e criar somem no modo de edição.
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));

    expect(screen.getByText("Modo edição")).toBeTruthy();
    expect(screen.getByText("Adicionar coluna")).toBeTruthy();
    expect(screen.getByText("Concluir edição")).toBeTruthy();
    expect(screen.queryByText("+ Nova tarefa")).toBeNull();
    expect(screen.queryByPlaceholderText("Buscar por título…")).toBeNull();
  });

  it("⚠️ no modo de edicao os cabecalhos ganham os controles", async () => {
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));

    // `Backlog` é o único alvo `OPEN`: sem ele tarefa nova não tem onde nascer.
    // O botão some (em vez de desabilitar) onde há impedimento.
    expect(screen.getByLabelText("Apagar Em Revisão")).toBeTruthy();
    expect(screen.queryByLabelText("Apagar Backlog")).toBeNull();
    expect(screen.getAllByText("não pode ser apagada").length).toBe(1);
    expect(screen.getByLabelText("Mover Backlog para a direita")).toBeTruthy();
    // Na ponta, a seta trava (o `null` de `comOrdem`).
    expect(
      (screen.getByLabelText("Mover Backlog para a esquerda") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("⚠️ no modo de edicao os CARDS param de arrastar", async () => {
    // Cards travam no modo. `onDragEnd` não roda em jsdom; o observável é o
    // `aria-disabled` do `useDraggable`.
    comAvulso([task({ id: "t1", title: "Uma tarefa", team_id: CRM, column_id: "av-backlog", board_id: AVULSO })]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);

    const card = () =>
      screen.getByText("Uma tarefa").closest('[aria-roledescription="draggable"]');
    expect(await screen.findByText("Uma tarefa")).toBeTruthy();
    expect(card()?.getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(screen.getByLabelText("Editar colunas"));
    expect(card()?.getAttribute("aria-disabled")).toBe("true");
  });

  it("⚠️ sair do modo com pendencias AVISA antes de descartar", async () => {
    // Sair descarta o lote; a coluna criada some porque nunca existiu no servidor.
    const confirmar = vi
      .spyOn(window, "confirm")
      .mockReturnValue(false);
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    fireEvent.click(screen.getByLabelText("Apagar Em Revisão"));
    fireEvent.click(screen.getByText("Sair"));

    expect(confirmar).toHaveBeenCalled();
    expect(screen.getByText("Modo edição")).toBeTruthy();
    confirmar.mockRestore();
  });

  it("sair SEM pendencias nao pergunta nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    comAvulso([]);
    render(<Board acoesDoQuadro={null} boardId={AVULSO} title="Campanhas" podeEditarColunas podeApagarColunas />);
    fireEvent.click(await screen.findByLabelText("Editar colunas"));
    fireEvent.click(screen.getByText("Sair"));

    expect(confirmar).not.toHaveBeenCalled();
    expect(screen.queryByText("Modo edição")).toBeNull();
    confirmar.mockRestore();
  });

  it("⚠️ manda o board_id do quadro em que a pessoa esta", async () => {
    // Sem isto a tarefa nasce no Quadro geral.
    comAvulso([]);
    expect((await criarTarefaPeloQuadro()).board_id).toBe(AVULSO);
  });

  it("⚠️ manda o team_id DO QUADRO, e nao o de quem clica", async () => {
    // Quem cria é a Ana, e o quadro é do CRM: o `team_id` tem de ser o do quadro.
    comAvulso([]);
    expect((await criarTarefaPeloQuadro()).team_id).toBe(CRM);
  });
});

// `/boards` falhando: com `boardId` a tela ficaria em "Carregando" para sempre;
// no geral, sem colunas, toda tarefa cairia em "fora da coluna".
describe("Board -- a API de quadros falhou", () => {
  it("⚠️ com boardId, mostra erro com botao em vez de carregar para sempre", async () => {
    montarApi([], []);
    vi.mocked(api.listBoards).mockRejectedValue(new Error("rede"));

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId="board-campanhas" title="Quadro · Campanhas" />);

    expect(
      await screen.findByText(/não consegui carregar os quadros/i)
    ).toBeTruthy();
    expect(screen.queryByText(/Carregando tarefas/i)).toBeNull();

    // O botão de tentar de novo.
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO]);
    fireEvent.click(screen.getByText("Tentar de novo"));
    await waitFor(() =>
      expect(screen.queryByText(/não consegui carregar os quadros/i)).toBeNull()
    );
  });

  it("⚠️ no Quadro geral, nao acusa o dado por uma requisicao que falhou", async () => {
    // Com `[]` a tela desenharia kanban sem coluna e culparia as tarefas.
    montarApi([task({ id: "t1", title: "Campanha de maio", team_id: RAIZ })], []);
    vi.mocked(api.listBoards).mockRejectedValue(new Error("rede"));

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} title="Quadro geral" />);

    expect(
      await screen.findByText(/não consegui carregar os quadros/i)
    ).toBeTruthy();
    expect(screen.queryByText(/coluna que não é deste quadro/i)).toBeNull();
  });
});

// Quadro recém-criado ainda fora da lista: a tela não pode cair no padrão
// (desenharia as colunas do geral sob o título do quadro novo).
describe("Board -- quadro pedido que ainda nao esta na lista", () => {
  it("⚠️ quadro APAGADO por outra pessoa diz que nao existe mais", async () => {
    // Quadro apagado por outra pessoa: a lista volta sem ele.
    montarApi([], []);
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO]);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId="board-apagado" title="Campanhas" />);
    expect(await screen.findByText("Este quadro não existe mais.")).toBeTruthy();
  });

  it("⚠️ NAO cai nas colunas do Quadro geral -- espera", async () => {
    montarApi([], []);
    // A lista não tem o quadro pedido: é o estado logo depois de criar.
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId="board-que-acabou-de-nascer" title="Quadro · Novo" />);

    await waitFor(() =>
      expect(vi.mocked(api.listBoards)).toHaveBeenCalled()
    );
    // As colunas do geral não podem aparecer (asserção sobre colunas que a fixture tem).
    for (const nome of QUADRO.colunas.map((c) => c.name)) {
      expect(screen.queryByText(nome)).toBeNull();
    }
    // ...e a tela espera ou diz que o quadro não existe. "Espera" é o `status`
    // do `Loading`, nomeado pelo `aria-label` (sem texto visível).
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: /Carregando/i }) ??
          screen.queryByText("Este quadro não existe mais.")
      ).toBeTruthy()
    );
  });

  it("⚠️ a corrida de criacao se resolve na SEGUNDA busca", async () => {
    // "Acabei de criar" e "foi apagado" são iguais num instante; a tela busca de
    // novo antes de desistir.
    montarApi([], []);
    const avulso = {
      id: "board-que-acabou-de-nascer",
      name: "Novo",
      team_id: CRM,
      is_default: false,
      // Coluna própria: prova que a tela desenhou o quadro novo.
      colunas: [
        {
          id: "nasc-revisao",
          name: "Em Revisão",
          color: "var(--status-progress-dot)",
          position: 0,
          semantic: "IN_PROGRESS" as const,
          notify_deadline: true,
          is_default_target: true,
          is_status_bridge: true,
        },
      ],
    };
    vi.mocked(api.listBoards)
      .mockResolvedValueOnce([QUADRO])
      .mockResolvedValue([QUADRO, avulso]);

    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} boardId="board-que-acabou-de-nascer" title="Quadro · Novo" />);

    expect(await screen.findByText("Em Revisão")).toBeTruthy();
    expect(screen.queryByText("Este quadro não existe mais.")).toBeNull();
  });
});

// "Ordenar" e "Mostrar arquivadas" ficam no painel de Filtros e continuam alcançáveis.
describe("Board -- Ordenar e Mostrar arquivadas vivem no painel", () => {
  it("não aparecem no cabeçalho, e aparecem ao abrir Filtros", async () => {
    montarApi([task({ id: "t1", title: "Tarefa qualquer" })], []);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa qualquer");

    // Com o painel FECHADO, nenhum dos dois está na tela.
    expect(screen.queryByLabelText("Mostrar arquivadas")).toBeNull();
    expect(screen.queryByText("Mostrar arquivadas")).toBeNull();
    expect(screen.queryByLabelText("Ordenar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));

    // `findBy*`: o painel é condicional.
    expect(await screen.findByLabelText("Ordenar")).toBeTruthy();
    expect(screen.getByText("Mostrar arquivadas")).toBeTruthy();
  });

  it("⚠️ o selo do funil NÃO conta os dois -- eles não estreitam o quadro", async () => {
    // `contaFiltrosAtivos` não conta arquivadas nem ordenação.
    montarApi([task({ id: "t1", title: "Tarefa qualquer" })], []);
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa qualquer");

    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(await screen.findByLabelText("Mostrar arquivadas"));

    // Sem sufixo de contagem.
    expect(screen.getByRole("button", { name: "Filtros" })).toBeTruthy();
  });
});

// Com dois times raiz há dois quadros gerais: a tela de cada raiz desenha o
// dela (`quadroGeralDoTime`), não o primeiro da lista.
describe("Board -- com DOIS quadros gerais, a raiz desenha o DELA", () => {
  const COMERCIAL = "team-comercial";
  const QUADRO_COM: Quadro = {
    id: "quadro-geral-comercial",
    name: "Quadro Geral",
    team_id: COMERCIAL,
    is_default: true,
    colunas: [
      {
        id: "col-com-backlog",
        name: "Backlog do Comercial",
        color: "var(--status-backlog-dot)",
        position: 0,
        semantic: "OPEN",
        notify_deadline: true,
        is_default_target: true,
        is_status_bridge: true,
      },
    ],
  };

  function montarDoisGerais() {
    montarApi(
      [
        task({
          id: "t-com",
          title: "Tarefa Teste Comercial",
          team_id: COMERCIAL,
          board_id: QUADRO_COM.id,
          column_id: "col-com-backlog",
        }),
      ],
      [],
    );
    // O do Marketing vem primeiro, como no banco.
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO, QUADRO_COM]);
  }

  it("a tarefa do Comercial aparece nas colunas do geral do Comercial, e não nas do Marketing", async () => {
    montarDoisGerais();
    render(<Board acoesDoQuadro={null} podeEditarColunas={false} podeApagarColunas={false} rootTeamId={COMERCIAL} title="Quadro Geral" />);
    expect(await screen.findByText("Tarefa Teste Comercial")).toBeTruthy();
    expect(screen.getByText("Backlog do Comercial")).toBeTruthy();
    // "Em Andamento" só existe no geral do Marketing.
    expect(screen.queryByText("Em Andamento")).toBeNull();
  });
});
