/**
 * Board -- quadro de SUBTIME. PRIMEIRO teste de componente do projeto.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Ate 03/08/2026 o `include` do vitest era so
 * `lib/**`: os tres portoes (tsc, npm test, next build) passavam com a tela
 * quebrada. O ajuste do §8 (a pill "Interna" que mentia) e prova disso -- a
 * REGRA ficou coberta por 10 testes em `lib/filtrosQuadro`, mas a MONTAGEM
 * dela no Board (montar o mapa de projetos, esperar ele carregar, passar pro
 * card) nao tinha teste nenhum. Sabotar qualquer uma dessas tres coisas
 * deixava os portoes verdes.
 *
 * O QUE ESTE ARQUIVO **NAO** TESTA, de proposito:
 *   - drag-and-drop (dnd-kit exige eventos de ponteiro que o jsdom nao gera
 *     de forma confiavel; teste disso e E2E, nao unitario);
 *   - aparencia (cor, espacamento, tema) -- continua sendo conferencia visual;
 *   - REGRA de negocio. Se um teste daqui precisar afirmar uma regra, a regra
 *     esta no componente e deveria estar em `lib/` (fronteira da Spec 027).
 *
 * O que ele TRAVA: a fiacao. Board le a fonte certa, espera o dado certo
 * antes de pintar, e entrega ao card o que classificou.
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
import type { Member, Project, Task, Team } from "@/lib/api";

// ⚠️ `importOriginal` em vez de fabrica seca: `@/lib/api` tem ~40 exports e
// TaskCard/TaskModal/TaskDetail importam varios deles. Uma fabrica que so
// devolvesse os cinco usados pelo Board faria os outros virarem `undefined`
// no import -- erro que aparece longe da causa.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listAllTasks: vi.fn(),
    listAllProjects: vi.fn(),
    listMembers: vi.fn(),
    listSubteams: vi.fn(),
    getRootTeamId: vi.fn(),
    updateTask: vi.fn(),
  };
});

const api = await import("@/lib/api");

const RAIZ = "team-marketing";
const CRM = "team-crm";
const ANA = "user-ana";

// ---------------------------------------------------------------
// Fixtures -- espelham o cenario REAL encontrado em producao no §8:
// tarefa com team_id do CRM dentro de projeto do Marketing (raiz).
// ---------------------------------------------------------------
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
    is_archived: false,
    is_personal: false,
    team_id,
    created_by: ANA,
    created_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
  };
}

const MEMBROS: Member[] = [
  {
    id: ANA,
    workspace_id: "ws",
    name: "Ana",
    email: "ana@x.com",
    is_active: true,
    team_id: CRM,
  },
];

const SUBTIMES: Team[] = [
  { id: CRM, name: "CRM e Automação", parent_team_id: RAIZ } as Team,
];

/** Monta as cinco respostas. `projetos` fica configuravel por teste. */
function montarApi(tasks: Task[], projetos: Project[]) {
  vi.mocked(api.listAllTasks).mockResolvedValue({
    items: tasks,
    total: tasks.length,
    truncated: false,
  });
  vi.mocked(api.listAllProjects).mockResolvedValue({
    items: projetos,
    total: projetos.length,
    truncated: false,
  });
  vi.mocked(api.listMembers).mockResolvedValue(MEMBROS);
  vi.mocked(api.listSubteams).mockResolvedValue(SUBTIMES);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
}

/**
 * O card do quadro: sobe do titulo pro container. O titulo e filho DIRETO da
 * raiz do card (TaskCard), entao um `parentElement` basta -- e quebra alto se
 * a estrutura mudar, que e o comportamento desejado num teste de montagem.
 */
function card(titulo: string): HTMLElement {
  const t = screen.getByText(titulo);
  if (!t.parentElement) throw new Error(`card sem container: ${titulo}`);
  return t.parentElement;
}

function pillDe(titulo: string): string | null {
  const c = within(card(titulo));
  const interna = c.queryByText("Interna");
  const compartilhada = c.queryByText("Compartilhada");
  if (interna) return "Interna";
  if (compartilhada) return "Compartilhada";
  return null;
}

// ⚠️ `globals: false` no vitest.config -> o auto-cleanup do @testing-library
// NAO se registra. Sem esta linha o segundo teste ve o DOM do primeiro.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/quadro/team-crm");
});

describe("Board -- quadro de subtime, pill de escopo (§8)", () => {
  it("tarefa AVULSA do subtime -> Interna", async () => {
    montarApi(
      [task({ id: "t1", title: "Ajuste avulso do CRM", team_id: CRM })],
      []
    );
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Ajuste avulso do CRM");
    expect(pillDe("Ajuste avulso do CRM")).toBe("Interna");
  });

  /**
   * ESTE e o teste que carrega o §8, na TELA. As 7 tarefas achadas em
   * producao tinham exatamente esta forma. Ate 03/08 o card dizia "Interna" e
   * o workspace inteiro as via, porque quem enxerga o projeto enxerga a
   * tarefa (task_guards.py:67-69).
   */
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Pipeline HubSpot");
    expect(pillDe("Pipeline HubSpot")).toBe("Compartilhada");
  });

  it("tarefa em projeto DO subtime -> Interna", async () => {
    montarApi(
      [
        task({
          id: "t3",
          title: "Automação interna",
          team_id: RAIZ,
          project_id: "p-crm",
        }),
      ],
      [project("p-crm", CRM)]
    );
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Automação interna");
    expect(pillDe("Automação interna")).toBe("Interna");
  });

  it("D3 -- projeto AUSENTE da lista: card aparece, SEM pill", async () => {
    // Lista truncada, projeto arquivado, ou a chamada falhou. O card nao pode
    // sumir (D2=A: quem criou continua vendo), mas tambem nao pode prometer.
    montarApi(
      [
        task({
          id: "t4",
          title: "Integração desconhecida",
          team_id: CRM,
          project_id: "p-fantasma",
        }),
      ],
      []
    );
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Integração desconhecida");
    expect(pillDe("Integração desconhecida")).toBeNull();
  });

  it("D4 -- projeto sem time: card aparece, SEM pill", async () => {
    montarApi(
      [
        task({
          id: "t5",
          title: "Tarefa em projeto sem time",
          team_id: CRM,
          project_id: "p-sem-time",
        }),
      ],
      [project("p-sem-time", null)]
    );
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa em projeto sem time");
    expect(pillDe("Tarefa em projeto sem time")).toBeNull();
  });
});

describe("Board -- guardas de carregamento", () => {
  /**
   * A GUARDA. Se o Board pintar antes dos projetos chegarem, o mapa esta
   * vazio: toda tarefa em projeto nasce sem pill e ganha uma um instante
   * depois. Piscada que nenhum portao pega e que print de tela raramente
   * flagra (depende do timing da captura).
   */
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

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    // Os outros quatro endpoints ja resolveram; so os projetos faltam.
    await waitFor(() => {
      expect(screen.getByText(/Carregando tarefas/)).toBeTruthy();
    });
    expect(screen.queryByText("Leads inbound")).toBeNull();

    liberar({ items: [project("p-mkt", RAIZ)], total: 1, truncated: false });
    await screen.findByText("Leads inbound");
    // E quando pinta, ja pinta com a pill CERTA -- nunca sem e depois com.
    expect(pillDe("Leads inbound")).toBe("Compartilhada");
  });

  /**
   * ⚠️ O outro lado da guarda, e o mais facil de errar: se `listAllProjects`
   * FALHAR e a flag ficar em false, o quadro trava em "Carregando" para
   * sempre. Por isso ela vira true no `.finally`, nao no `.then`.
   */
  it("projetos FALHANDO nao travam o quadro", async () => {
    montarApi(
      [task({ id: "t7", title: "Tarefa avulsa", team_id: CRM })],
      []
    );
    vi.mocked(api.listAllProjects).mockRejectedValue(new Error("500"));

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa avulsa");
    expect(pillDe("Tarefa avulsa")).toBe("Interna");
  });
});

describe("Board -- filtro de responsável (multi-seleção, UNIÃO)", () => {
  const BEATRIZ = "user-beatriz";
  const CLARA = "user-clara";

  const EQUIPE: Member[] = [
    { id: BEATRIZ, workspace_id: "ws", name: "Beatriz", email: "b@x.com", is_active: true, team_id: CRM },
    { id: CLARA, workspace_id: "ws", name: "Clara", email: "c@x.com", is_active: true, team_id: CRM },
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

  it("sem filtro, mostra as três", async () => {
    montarEquipe();
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    expect(screen.getByText("Tarefa da Clara")).toBeTruthy();
    expect(screen.getByText("Tarefa de ninguém")).toBeTruthy();
  });

  it("uma marcada mostra só a dela", async () => {
    montarEquipe();
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    abrirPainel();
    marcar("Beatriz");

    expect(screen.getByText("Tarefa da Beatriz")).toBeTruthy();
    expect(screen.queryByText("Tarefa da Clara")).toBeNull();
    expect(screen.queryByText("Tarefa de ninguém")).toBeNull();
  });

  /**
   * A PERGUNTA QUE A CAMILA FEZ, virada em teste. Duas marcadas = as tarefas
   * de CADA uma, separadamente. Com "E" (interseção) as duas sumiriam e o
   * quadro ficaria vazio -- justamente quando ela espera ver mais coisa.
   */
  it("UNIÃO: duas marcadas mostram as tarefas de CADA uma", async () => {
    montarEquipe();
    render(<Board subteamId={CRM} title="CRM e Automação" />);
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa da Beatriz");
    abrirPainel();
    marcar("Beatriz");
    expect(screen.queryByText("Tarefa da Clara")).toBeNull();
    marcar("Beatriz");
    expect(screen.getByText("Tarefa da Clara")).toBeTruthy();
  });

  it("duas pessoas contam como UM filtro, não dois", async () => {
    montarEquipe();
    render(<Board subteamId={CRM} title="CRM e Automação" />);
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Raiz sem responsável");
    abrirPainel();
    marcar("Beatriz");
    expect(screen.getByText("Raiz sem responsável")).toBeTruthy();
  });
});
