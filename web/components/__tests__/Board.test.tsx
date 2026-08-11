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
import type { Member, Project, Quadro, Task, Team } from "@/lib/api";

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
    // ⚠️ Fatia 4c: o quadro passou a DESENHAR as colunas da API. Sem este
    // mock, `quadros` fica `null` para sempre e a tela nao sai de
    // "Carregando tarefas…" -- 16 testes deste arquivo caem de uma vez, todos
    // com "nao achou o texto", nenhum falando de coluna.
    listBoards: vi.fn(),
    updateTask: vi.fn(),
    duplicateTask: vi.fn(),
    // ⚠️ O botao "Duplicar" do TaskDetail exige `task.create`. Sem mockar o
    // usuario, `me` fica null, o botao nao renderiza, e o teste falha por
    // permissao -- nao pelo que ele quer medir.
    currentUser: vi.fn(),
    listComments: vi.fn(),
    // ⚠️ O TaskModal filtra o pre-preenchimento por ALCANCE (D9). Sem este
    // mock a lista vem vazia, nenhum responsavel sobrevive, e o
    // `motivoNaoCria` (responsavel obrigatorio, 29/07) bloqueia o Salvar --
    // o teste falharia por regra de criacao, nao pelo que quer medir.
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
  };
});

const api = await import("@/lib/api");

const QUADRO_ID = "board-geral";

/**
 * As colunas do quadro que as fixtures deste arquivo usam.
 *
 * ⚠️ SO AS QUE OS TESTES USAM, e nao as oito -- mesma decisao (e mesmo motivo)
 * do `minhasTarefas.test.tsx`: a paridade com o backend e afirmada em
 * `lib/__tests__/paridadeColuna.test.ts`, contra a tabela completa. Repetir as
 * oito aqui seria uma terceira copia da mesma tabela para manter em dia.
 *
 * ⚠️ `col-backlog` E O `column_id` PADRAO DA FIXTURE `task()` abaixo. Trocar um
 * sem o outro tira todos os cards da tela: eles caem no contador de
 * "fora da coluna" do `Board`, sem erro nenhum.
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
    },
    {
      id: "col-progress",
      name: "Em Andamento",
      color: "var(--status-progress-dot)",
      position: 2,
      semantic: "IN_PROGRESS",
      notify_deadline: true,
      is_default_target: true,
    },
    {
      id: "col-done",
      name: "Concluído",
      color: "var(--status-done-dot)",
      position: 5,
      semantic: "DONE",
      notify_deadline: true,
      is_default_target: true,
    },
  ],
};

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
    // ⚠️ Spec 036, fatia 3: `board_id`/`column_id` viraram obrigatorios em
    // `Task`. Um valor qualquer serve aqui -- este arquivo nao testa quadro --,
    // mas eles TEM de existir, senao o `tsc` recusa a fixture. Nao troque por
    // `as Task`: foi exatamente um `as` que escondeu este buraco por horas em
    // 10/08, no `minhasTarefas.test.tsx`.
    board_id: QUADRO_ID,
    column_id: "col-backlog",
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

describe("Board -- depois de duplicar, abre a CÓPIA", () => {
  /**
   * Defeito encontrado na tela em 04/08: duplicar deixava o detalhe na tarefa
   * ORIGINAL. A pessoa clicava "Duplicar", o modal fechava, e ela continuava
   * olhando a mesma tarefa -- sem nenhum sinal de que algo tinha sido criado.
   *
   * ⚠️ Pior no caso da subtarefa: a cópia nasce irmã (D3), e o quadro só
   * desenha `depth === 0`. Ela não vira card em lugar nenhum; só existe
   * dentro da checklist do pai. Sem abrir a cópia, "sumiu" é a leitura
   * honesta de quem clicou.
   */
  it("o detalhe passa a mostrar a cópia, não a origem", async () => {
    const ORIGEM = task({ id: "o1", title: "Tarefa original", team_id: CRM });
    montarApi([ORIGEM], []);
    // ⚠️ A cópia é SUBTAREFA de propósito (`depth 1`, pai fora da lista). Na
    // primeira versão deste teste a cópia era raiz, virava CARD no quadro, e
    // a asserção casava com o card -- a sabotagem "não abrir a cópia" passava
    // verde. Sendo subtarefa de um pai desconhecido, ela não vira card
    // (`depth !== 0`) nem entra na checklist da origem: a ÚNICA forma do
    // título aparecer é o detalhe estar aberto nela.
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa original");

    fireEvent.click(screen.getByText("Tarefa original"));
    await screen.findByRole("button", { name: "Duplicar" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));

    // Modal de duplicar aberto, já pré-preenchido.
    await screen.findByText("Duplicar tarefa");
    // ⚠️ DOIS botões "Duplicar" no DOM: o do TaskDetail (que abriu isto) e o
    // do rodapé do modal. Ordem do DOM NÃO resolve -- no Board o TaskModal é
    // renderizado ANTES do TaskDetail, então "o último" é o errado. O do
    // detalhe é o único com `title`.
    const salvar = screen
      .getAllByRole("button", { name: /^Duplicar$/ })
      .find((b) => !b.getAttribute("title"));
    if (!salvar) throw new Error("botão Duplicar do modal não encontrado");
    fireEvent.click(salvar);

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    // O detalhe agora é o da CÓPIA.
    await waitFor(() => {
      expect(screen.getAllByText("Cópia de Tarefa original").length).toBeGreaterThan(0);
    });
  });
});

describe("Board -- depois de duplicar, a CÓPIA aparece com as subtarefas", () => {
  /**
   * Defeito relatado na tela em 05/08: "a cópia é criada, mas sem as
   * subtarefas". As subtarefas EXISTEM no banco -- o backend copia a
   * subárvore inteira na mesma transação. Quem mente é o quadro.
   *
   * `aoSalvar()` insere no estado `tasks` SÓ a tarefa devolvida pelo POST (a
   * cópia-pai). As filhas nascidas no backend não estão em lugar nenhum do
   * estado, e `filhosFocado` (Board.tsx:674) é derivado de `tasks`. Como o
   * `TaskDetail` NÃO busca os próprios filhos -- ele recebe `filhos` como
   * prop -- a checklist da cópia abre vazia. F5 e elas aparecem.
   *
   * ⚠️ O teste de cima ("abre a CÓPIA") não pega isto: a origem dele não tem
   * filha nenhuma, então não há checklist a conferir. Fixture fraca, mesmo
   * padrão do §9 do handoff.
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
    // 1a chamada: estado ANTES de duplicar. Qualquer chamada seguinte já
    // enxerga a cópia e a filha dela -- é exatamente isso que o refetch
    // depois de duplicar tem de trazer.
    vi.mocked(api.listAllTasks)
      .mockResolvedValueOnce({ items: [ORIGEM, FILHA], total: 2, truncated: false })
      .mockResolvedValue({
        items: [ORIGEM, FILHA, COPIA, FILHA_DA_COPIA],
        total: 4,
        truncated: false,
      });
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...COPIA,
      skipped_assignees: [],
      promoted_to_root: false,
    });

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Tarefa original");

    fireEvent.click(screen.getByText("Tarefa original"));
    await screen.findByRole("button", { name: "Duplicar" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));

    await screen.findByText("Duplicar tarefa");
    // A caixa da D7 conta a filha viva -- se ela sumir, o defeito é outro.
    await screen.findByText("Levar as subtarefas (1 diretas)");

    const salvar = screen
      .getAllByRole("button", { name: /^Duplicar$/ })
      .find((b) => !b.getAttribute("title"));
    if (!salvar) throw new Error("botão Duplicar do modal não encontrado");
    fireEvent.click(salvar);

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    await screen.findAllByText("Cópia de Tarefa original");

    // ⚠️ "Passo um" NÃO vira card (depth 1) e a origem não está mais aberta:
    // a única forma do título aparecer é a checklist da CÓPIA estar montada
    // com o que o backend criou.
    await waitFor(() => {
      expect(screen.getAllByText("Passo um").length).toBeGreaterThan(0);
    });
  });
});

describe("Board -- busca por título alcança as SUBTAREFAS (05/08)", () => {
  /**
   * A REGRA está em `lib/filtrosQuadro:raizesQueCasamBusca`, com os testes
   * dela. O que este teste trava é a FIAÇÃO: o Board consulta o conjunto de
   * raízes em vez de comparar `t.title` na mão. Trocar a regra por
   * `normalizarBusca(t.title).includes(...)` de novo derruba este teste.
   */
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha de matrícula");

    fireEvent.change(screen.getByPlaceholderText("Buscar por título…"), {
      // Sem acento de propósito: a normalização é a mesma das duas telas.
      target: { value: "roteiro do video" },
    });

    // A raiz da subtarefa que casou continua no quadro...
    expect(screen.getByText("Campanha de matrícula")).toBeTruthy();
    // ...e a que não tem nada a ver, não.
    expect(screen.queryByText("Newsletter de julho")).toBeNull();
    // ⚠️ A subtarefa NÃO vira card (o quadro só desenha `depth === 0`) --
    // se ela aparecesse, a regra teria virado outra coisa.
    expect(screen.queryByText("Roteiro do vídeo")).toBeNull();
  });
});

// =====================================================================
// Spec 036, fatia 4c-1 -- o quadro desenha COLUNAS DA API, e nao a lista
// cravada de status.
//
// SABOTAGENS -- ✅ MEDIDAS EM 10/08/2026 (509 testes no front, 24 aqui):
//
//   1. `const quadro = quadros.find((q) => q.is_default)` no lugar de
//      `quadroDoLote ?? ...` (ou seja: escolher o quadro pela flag em vez de
//      pelas tarefas). **Cai UM:** "desenha as colunas do quadro em que as
//      tarefas VIVEM". ⚠️ ANTES DESSE TESTE EXISTIR, ESSA SABOTAGEM PASSAVA
//      VERDE -- com um quadro so, as duas regras dao a mesma resposta. O
//      portao nasceu da sabotagem, nao do plano.
//
//   2. Voltar `diasParadoPorColuna(coluna, ...)` para
//      `diasParado(..., task.status, ...)` no `TaskCard`. **Cai UM:** "coluna
//      que nao cobra prazo nao ganha selo de parada".
//
//   3. Apagar o `else foraDaColuna++` do agrupamento. **Cai UM:** "card em
//      coluna desconhecida nao some em silencio".
//
//   4. Trocar o contador da checklist de volta para `t.status === "COMPLETED"`.
//      **Cai UM:** "a checklist conta a subtarefa pela COLUNA, nao pelo
//      status". ⚠️ Este e o defeito que a CONFERENCIA MANUAL pegou -- as
//      subtarefas so apareciam concluidas depois do F5.
//
//   5. Trocar o filtro de prazo de volta para `t.status !== "COMPLETED"`.
//      **Cai UM:** "tarefa em coluna de conclusão não conta como atrasada".
//      ⚠️ ANTES DESSE TESTE EXISTIR, ESSA SABOTAGEM PASSAVA VERDE -- segundo
//      leitor de `status` sem portao, achado do mesmo jeito que o primeiro:
//      rodando a sabotagem, nao planejando.
//
//   ⚠️ E UMA QUE NAO SERVE: trocar `porColuna[t.column_id]` por
//   `porColuna[t.status]` derruba 21 dos 24, porque nenhum card acha coluna e
//   a tela fica vazia. Prova que a linha e viva, nao QUAL decisao ela carrega.
//   Sabotagem que derruba tudo nao afirma nada -- registrada aqui para
//   ninguem a repetir achando que mediu algo.
//
// ⚠️ O QUE NENHUM DESTES PROVA: que ARRASTAR funciona. Drag-and-drop nao e
// exercitavel em jsdom (registrado no topo deste arquivo), entao o
// `onDragEnd` -- que e a metade mais arriscada da fatia -- continua coberto
// SO por conferencia manual na tela. Estes testes cobrem a outra metade: de
// onde vem a coluna, e o que acontece com card que nao cabe em nenhuma.
// =====================================================================
describe("Board -- as colunas vem da API (fatia 4c)", () => {
  it("desenha o nome das colunas do quadro, e nao os rotulos de status", async () => {
    montarApi([task({ id: "c1", title: "Post do blog" })], []);
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Post do blog");

    // Os tres nomes vem de `QUADRO.colunas[].name`.
    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Em Andamento")).toBeTruthy();
    expect(screen.getByText("Concluído")).toBeTruthy();
    // ⚠️ E as outras CINCO colunas padrao NAO aparecem, porque este quadro so
    // tem tres. Se aparecessem, a lista ainda estaria vindo de `STATUSES`.
    expect(screen.queryByText("Bloqueado")).toBeNull();
    expect(screen.queryByText("Aprovação Externa")).toBeNull();
  });

  /**
   * ⚠️ O TESTE QUE PROVA A TROCA DE FONTE, e o unico que separa "le coluna" de
   * "le status": a tarefa tem `status: "COMPLETED"` e `column_id` de Backlog.
   * Agrupando por status ela cairia em Concluído; agrupando por coluna, cai em
   * Backlog. Esse par so existe de proposito num teste -- em producao a
   * invariante 3 do `invariantes.sql` garante que os dois concordam.
   */
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    const card = await screen.findByText("Card teimoso");

    // Sobe do texto do card ate a coluna e confere o cabecalho dela.
    const colunaBacklog = screen.getByText("Backlog").closest("div")
      ?.parentElement;
    expect(colunaBacklog?.textContent).toContain("Card teimoso");
    expect(card).toBeTruthy();
  });

  /**
   * ⚠️ PERDA VISIVEL, e nao silenciosa. Card cuja coluna nao esta neste quadro
   * some da tela -- nao ha coluna onde desenha-lo. O que este teste prende e
   * que a tela DIZ isso. Perda silenciosa e o defeito que este projeto mais
   * pagou, e aqui ela seria invisivel: um card a menos ninguem conta.
   */
  it("card em coluna desconhecida nao some em silencio", async () => {
    montarApi(
      [
        task({ id: "c3", title: "Card normal" }),
        task({ id: "c4", title: "Card perdido", column_id: "col-de-outro-quadro" }),
      ],
      []
    );
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Card normal");

    expect(screen.queryByText("Card perdido")).toBeNull();
    expect(
      screen.getByText(/1 tarefa está em\s+uma coluna que não é deste quadro/)
    ).toBeTruthy();
  });

  /**
   * A guarda de carregamento, igual a dos projetos: sem as colunas nao ha
   * kanban, e pintar cards para reorganiza-los meio segundo depois e pior do
   * que esperar.
   */
  it("nao pinta card antes de os QUADROS responderem", async () => {
    let liberar!: (v: Quadro[]) => void;
    montarApi([task({ id: "c5", title: "Aguardando quadro" })], []);
    vi.mocked(api.listBoards).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await waitFor(() => {
      expect(screen.getByText(/Carregando tarefas/)).toBeTruthy();
    });
    expect(screen.queryByText("Aguardando quadro")).toBeNull();

    liberar([QUADRO]);
    await screen.findByText("Aguardando quadro");
  });

  /**
   * ⚠️ O OUTRO LADO DA GUARDA, e o que trava a tela para sempre se sair
   * errado: `listBoards` FALHANDO tem de deixar `quadros` em `[]`, e nao em
   * `null`. Mesmo defeito que a flag dos projetos ja teve.
   */
  it("quadros FALHANDO nao travam a tela em Carregando", async () => {
    montarApi([task({ id: "c6", title: "Sem quadro nenhum" })], []);
    vi.mocked(api.listBoards).mockRejectedValue(new Error("500"));

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    // Sai do "Carregando": nao ha coluna, entao nao ha card -- mas a tela
    // responde, e o contador denuncia a tarefa que ficou de fora.
    await waitFor(() => {
      expect(screen.queryByText(/Carregando tarefas/)).toBeNull();
    });
    expect(screen.queryByText("Sem quadro nenhum")).toBeNull();
  });
});

// =====================================================================
// Fatia 4c-1 -- o CARD decide pela coluna, e nao mais por `task.status`.
// =====================================================================
describe("Board -- o card decide pela coluna (fatia 4c)", () => {
  /**
   * ⚠️ O selo "Parada há X d" e a prova mais barata da troca de fonte, porque
   * as duas regras discordam num caso construivel: `pararEhNoticia` exige
   * semantica `IN_PROGRESS` **e** `notify_deadline`. Uma coluna de trabalho
   * ativo com `notify_deadline: false` -- que e exatamente como a coluna
   * `Bloqueado` nasce -- nao ganha selo. A regra antiga, por status, olhava
   * uma lista literal de status e nao sabia disso.
   *
   * Este teste monta um quadro PROPRIO, com a coluna extra, em vez de mexer no
   * `QUADRO` compartilhado: acrescentar uma quarta coluna la derrubaria o
   * teste que afirma que so tres aparecem.
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

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Parada faz tempo");

    // A que esta em "Em Andamento" (cobra prazo) ganha o selo...
    expect(screen.getAllByText(/Parada há \d+ d/).length).toBe(1);
    // ...e a que esta em "Bloqueado" nao ganha, apesar de as duas terem o
    // MESMO `status` na fixture e o mesmo `updated_at`.
    const cardTravada = screen.getByText("Travada faz tempo").closest("div")
      ?.parentElement;
    expect(cardTravada?.textContent).not.toMatch(/Parada há/);
  });
});

// =====================================================================
// Fatia 4c-1 -- de ONDE sai o quadro cujas colunas a tela desenha.
//
// ⚠️ ESTE BLOCO EXISTE PORQUE A DECISAO ESTAVA SEM PORTAO. Na fatia 4c o
// quadro passou a ser descoberto pelo `board_id` DAS TAREFAS, e nao pela flag
// `is_default` (decisao de 10/08, opcao C). Com um quadro so -- que e
// producao hoje, e era o mundo de todos os outros testes deste arquivo -- as
// duas regras dao a MESMA resposta, entao nada quebrava se alguem trocasse
// uma pela outra. Descoberto rodando a sabotagem, nao pensando nela.
// =====================================================================
describe("Board -- o quadro sai das TAREFAS, nao da flag de padrão (fatia 4c)", () => {
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
      },
      {
        id: "seo-revisar",
        name: "Em revisão de SEO",
        color: "#2563EB",
        position: 1,
        semantic: "IN_PROGRESS",
        notify_deadline: true,
        is_default_target: false,
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
    // Os DOIS quadros voltam da API, e o padrao vem primeiro de propósito:
    // quem escolhesse por `is_default` acharia o geral e desenharia as
    // colunas erradas -- com o card sumindo, porque a coluna dele nao estaria
    // na lista.
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO, INTERNO]);

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Pauta de agosto");

    expect(screen.getByText("A escrever")).toBeTruthy();
    expect(screen.getByText("Em revisão de SEO")).toBeTruthy();
    // ⚠️ E as colunas do quadro GERAL nao aparecem. Se aparecessem, a escolha
    // teria voltado a ser `is_default`.
    expect(screen.queryByText("Backlog")).toBeNull();
    expect(screen.queryByText("Em Andamento")).toBeNull();
  });

  /**
   * O caso sem resposta certa, registrado como comportamento e nao como
   * acidente: lote VAZIO nao tem `board_id` para ler, entao cai no quadro
   * padrao. E so afordancia -- nao ha card nenhum para desenhar --, mas a tela
   * precisa mostrar ALGUMA coisa, e mostrar o quadro geral e o unico palpite
   * honesto.
   */
  it("lote vazio cai no quadro padrão", async () => {
    montarApi([], []);
    vi.mocked(api.listBoards).mockResolvedValue([QUADRO, INTERNO]);

    render(<Board subteamId={CRM} title="CRM e Automação" />);
    // Sem tarefa nenhuma o quadro mostra o estado vazio, entao a asserção é
    // que a tela RESPONDE -- e não trava escolhendo quadro.
    await waitFor(() => {
      expect(screen.queryByText(/Carregando tarefas/)).toBeNull();
    });
  });
});

// =====================================================================
// Fatia 4c-1 -- os DOIS leitores de `task.status` que sobravam na tela.
//
// ⚠️ ESTE BLOCO NASCEU DA CONFERENCIA MANUAL DE 10/08, e nao do plano.
// Arrastar um pai para "Concluído" concluia a subarvore no banco, mas o
// contador do card so mudava depois de um F5. Causa: a atualizacao otimista
// mexe na COLUNA das subtarefas (a unica coisa que o front sabe derivar) e o
// contador ainda lia `status`.
//
// ⚠️ NENHUM DESTES DOIS TESTA O ARRASTO -- isso continua sem portao. Eles
// prendem o LEITOR: se ele voltar a olhar `status`, cai aqui.
// =====================================================================
describe("Board -- checklist e prazo leem a coluna (fatia 4c)", () => {
  it("a checklist conta a subtarefa pela COLUNA, nao pelo status", async () => {
    montarApi(
      [
        task({ id: "p1", title: "Campanha com filhas" }),
        // ⚠️ O PAR TORTO DE PROPOSITO: `status` ainda diz BACKLOG (e o que a
        // atualizacao otimista deixa para tras), a COLUNA ja e a de conclusao.
        // Contando por status daria 0/1; contando por coluna, 1/1.
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha com filhas");

    expect(screen.getByTitle("1 de 1 subtarefas concluídas")).toBeTruthy();
  });

  /**
   * ⚠️ CANCELADA NAO CONTA COMO CONCLUIDA. O enum do backend registra que
   * `DONE` e `CANCELLED` nao sao intercambiaveis justamente por causa desta
   * proporcao. Trocar o teste por `terminal()` faria uma subtarefa cancelada
   * aparecer como entregue.
   */
  it("subtarefa em coluna CANCELADA não conta como concluída", async () => {
    montarApi(
      [
        task({ id: "p2", title: "Campanha com cancelada" }),
        task({
          id: "f2",
          title: "Filha cancelada",
          parent_task_id: "p2",
          path: "p2.f2",
          depth: 1,
          column_id: "col-cancel",
        }),
      ],
      []
    );
    vi.mocked(api.listBoards).mockResolvedValue([
      {
        ...QUADRO,
        colunas: [
          ...QUADRO.colunas,
          {
            id: "col-cancel",
            name: "Cancelado",
            color: "var(--status-cancel-dot)",
            position: 6,
            semantic: "CANCELLED" as const,
            notify_deadline: true,
            is_default_target: true,
          },
        ],
      },
    ]);
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Campanha com cancelada");

    expect(screen.getByTitle("0 de 1 subtarefas concluídas")).toBeTruthy();
  });

  /**
   * ⚠️ ESTE TESTE EXISTE PORQUE A SABOTAGEM PASSOU VERDE. Trocar o filtro de
   * prazo de volta para `t.status !== "COMPLETED"` nao derrubava nada -- o
   * segundo leitor de `status` estava sem portao, exatamente como a escolha do
   * quadro esteve antes de o teste dos dois quadros existir.
   */
  it("tarefa em coluna de conclusão não conta como atrasada", async () => {
    montarApi(
      [
        // Prazo vencido nas duas. A diferenca e SO a coluna -- e o `status` de
        // ambas continua BACKLOG, entao quem ler status acha que as duas
        // estao atrasadas.
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
    render(<Board subteamId={CRM} title="CRM e Automação" />);
    await screen.findByText("Atrasada de verdade");

    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    fireEvent.change(screen.getByLabelText("Prazo"), {
      target: { value: "atrasadas" },
    });

    expect(screen.getByText("Atrasada de verdade")).toBeTruthy();
    expect(screen.queryByText("Entregue mas vencida")).toBeNull();
  });
});
