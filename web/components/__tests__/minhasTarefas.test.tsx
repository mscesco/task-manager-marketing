/**
 * `/minhas-tarefas` -- teste de componente, escrito ANTES da fatia 4b.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A fatia 4 da Spec 036 troca `STATUSES` (const
 * sincrona) por colunas vindas da API, e a sondagem da fatia 4 (absorvida no
 * `plan.md`, §Fatia 4 -- por que ela virou TRES) mediu que esta
 * tela e onde a mudanca pesa: 1195 linhas, 7 usos de `STATUSES`, tres
 * constantes derivadas em escopo de MODULO (`STATUS_LABEL`, `STATUS_COLOR`,
 * `TODOS_STATUS`) e -- o ponto duro do §5 -- o filtro padrao rodando como
 * inicializador de `useState`, no primeiro render, antes de qualquer fetch.
 *
 * Ate 10/08/2026 esta tela tinha ZERO teste de componente. Os tres portoes
 * (tsc, npm test, next build) passavam com ela quebrada.
 *
 * ⚠️ ESTE ARQUIVO NAO PROVA QUE A FATIA 4b ESTA CERTA. Ele prova que o
 * comportamento de HOJE continua valendo depois dela. Se um destes testes
 * ficar vermelho durante a 4b, a pergunta e "isso era intencional?" -- e se
 * for, o teste se reescreve junto com a decisao, nao se apaga.
 *
 * ⚠️ DECISAO A, TOMADA EM 10/08: a tela NAO renderiza ate as colunas
 * chegarem. E a alternativa ao "lista pisca mostrando concluidas que ninguem
 * pediu". A sondagem dizia que isso daria "um estado de carregando que a tela
 * nao tinha", e **isso esta errado**: o gate ja existe hoje
 * (`page.tsx:582`, `if (!items) return <div>Carregando…</div>`). A 4b
 * acrescenta uma condicao a esse `if`, nao uma tela nova. O teste 1 prende o
 * gate para que essa extensao seja barata e verificavel.
 *
 * O QUE ESTE ARQUIVO **NAO** TESTA, de proposito (mesma fronteira do
 * `Board.test.tsx`, o primeiro teste de componente do projeto):
 *   - drag-and-drop (dnd-kit exige eventos de ponteiro que o jsdom nao gera
 *     de forma confiavel; isso e E2E);
 *   - aparencia -- cor, espacamento, tema continuam sendo conferencia visual;
 *   - REGRA. `statusPadraoMinhasTarefas` ja tem 296 linhas de teste em
 *     `lib/__tests__/status.test.ts`. Aqui se testa a MONTAGEM dela na tela,
 *     que e exatamente o que nao tinha cobertura.
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

// ⚠️ O AppShell usa `useRouter`/`usePathname`. Mock incompleto de
// next/navigation derruba a arvore inteira com `invariant expected app router
// to be mounted` -- um erro que nao fala de AppShell nenhum. Medido em
// 10/08/2026: sem estes dois blocos, os cinco testes deste arquivo falham no
// primeiro render, antes de qualquer assercao.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/minhas-tarefas",
  useSearchParams: () => new URLSearchParams(),
}));

// ⚠️ AppShell fora do teste, mesmo motivo do `ArquivadasPai.test.tsx`: ele e
// importado por 13 paginas (nao existe `layout.tsx`), busca sessao e times, e
// monta o menu inteiro. Arrastar isso pra dentro de um teste sobre o filtro
// padrao de `/minhas-tarefas` faz o teste falhar por coisas que nao tem
// relacao com o que ele mede. O que se quer medir aqui e a PAGINA.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ⚠️ `importOriginal` em vez de fabrica seca: `@/lib/api` tem ~40 exports e
// TaskCard/TaskModal/TaskDetail importam varios deles. Uma fabrica que so
// devolvesse os usados por esta pagina faria os outros virarem `undefined` no
// import -- erro que aparece longe da causa. Mesmo motivo do `Board.test.tsx`.
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
 * As colunas do quadro geral, como o `GET /boards` as devolve.
 *
 * ⚠️ SO AS QUE OS TESTES USAM, e nao as oito. A paridade com o backend e
 * afirmada em `lib/__tests__/paridadeColuna.test.ts`, contra a tabela
 * completa; repetir as oito aqui seria uma segunda copia da mesma tabela para
 * manter em dia.
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
 * ⚠️ `Em Revisão` e `IN_PROGRESS` e NAO e alvo -- entao ela cai em
 * `Em Andamento` pelo degrau 2 da ADR 0042, e o card fica agrupado numa coluna
 * com OUTRO nome. E exatamente esse caso que a tag existe para explicar.
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
    team_id: RAIZ,
  } as Member,
];

/**
 * As cinco chamadas que a tela dispara ao montar (`page.tsx`, efeito de
 * carga). `truncated` e configuravel porque o teste 5 e sobre ele.
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
    // ⚠️ ESTE E O TESTE QUE A FATIA 4b VAI ESTENDER. Hoje o gate espera
    // `items`; depois da 4b ele espera `items` E as colunas. A promessa
    // pendente abaixo e o que segura o primeiro render.
    let resolver: (v: unknown) => void = () => {};
    const pendente = new Promise((r) => {
      resolver = r;
    });
    montarApi([]);
    vi.mocked(api.listAllMyAssignments).mockReturnValue(
      pendente as ReturnType<typeof api.listAllMyAssignments>
    );

    render(<MinhasTarefasPage />);

    expect(screen.getByText(/Carregando/i)).toBeTruthy();
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
    // ⚠️ O IRMAO DO TESTE 1, e o que a fatia 4b acrescentou ao portao: a lista
    // ja chegou, as colunas nao. Sem esta condicao no `if`, a tela pintaria
    // sem filtro e reordenaria quando as colunas chegassem -- a lista piscando
    // com concluidas que ninguem pediu, que e o cenario que a decisao de
    // 10/08 recusou.
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
      expect(screen.getByText(/Carregando/i)).toBeTruthy();
    });
    expect(screen.queryByText("Tarefa qualquer")).toBeNull();

    resolver({ colunas: COLUNAS, indice: indiceDeColunas(QUADROS, GERAL_ID) });

    await waitFor(() => {
      expect(screen.getByText("Tarefa qualquer")).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ 1c
  it("os chips de filtro vem da API, com o NOME da coluna", async () => {
    // ⚠️ Antes da 4b os rotulos vinham de `STATUSES`, cravado no front. Este
    // teste cai se alguem voltar a ler dali -- e e o unico que prova que o
    // caminho novo chegou na tela, e nao so no modulo.
    montarApi([item({ id: "t1", title: "Uma tarefa" })]);

    render(<MinhasTarefasPage />);
    await waitFor(() => {
      expect(screen.getByText("Uma tarefa")).toBeTruthy();
    });

    // ⚠️ MIRA NO BOTAO, e nao no texto solto. Medido em 10/08: "Em Andamento"
    // aparece DUAS vezes na tela depois da 4b -- como chip de filtro e como
    // rotulo da linha --, e as duas vem de `coluna.name`. Um `getByText`
    // simples estoura com "Found multiple elements", e a ambiguidade e ela
    // propria a prova de que a migracao chegou nos dois lugares.
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
    // ⚠️ O PONTO DURO DO §5 DA SONDAGEM. `statusPadraoMinhasTarefas()` roda
    // como inicializador de `useState` -- no primeiro render, antes do fetch.
    // Quando a lista de status vier da API, este inicializador nao tem mais o
    // dado na hora em que roda. Este teste e o que diz se a solucao escolhida
    // preservou o comportamento.
    //
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
    // O outro lado do teste 2: o padrao esconde, mas o usuario consegue ver.
    // Sem este, uma 4b que simplesmente removesse o filtro passaria no 2.
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
    // ⚠️ Parece obvio e nao e: as duas rotas devolvem task e o componente
    // importa as duas (`listTasks` e usada para buscar as subtarefas do
    // detalhe). Trocar a fonte por engano durante a 4b daria uma tela
    // plausivel, cheia de tarefas que nao sao da pessoa.
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
    // Perda silenciosa vira aviso honesto (`truncadoTotal`). O numero exibido
    // e o TOTAL do backend, nao o tamanho da lista carregada -- por isso o
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

// =====================================================================
// Spec 036, fatia 4c-2 -- o KANBAN desta tela tambem le colunas da API.
//
// ⚠️ A vista de LISTA foi migrada na 4b; esta ficou para tras por BLOQUEIO DE
// CONTRATO (o arrastar mandava `status`, e o front nao sabe traduzir coluna ->
// status). O bloqueio acabou com o `PATCH column_id` da fatia 5a.
//
// ⚠️ O ARRASTAR EM SI CONTINUA SEM PORTAO -- jsdom nao exercita drag-and-drop.
// Estes testes cobrem o DESENHO e o AGRUPAMENTO das colunas; o `onDragEnd`
// desta tela so tem conferencia manual, igual ao do `Board.tsx`.
//
// SABOTAGENS -- ✅ MEDIDAS EM 10/08/2026:
//
//   D. `map[t.column_id]` -> `map[t.status]` no agrupamento. **Caem 2**:
//      "agrupa o card pela COLUNA" e "card em coluna desconhecida nao some em
//      silencio".
//   E. Apagar o `else fora++`. **Cai 1**: "card em coluna desconhecida nao
//      some em silencio".
//   F. Cabecalho da coluna com nome fixo em vez de `coluna.name`. **Cai 1**:
//      "as colunas do kanban tem o NOME que veio da API".
//
// ⚠️ NENHUMA delas derruba a suite inteira, e isso e o ponto: as tres apontam
// para decisoes DIFERENTES. Uma sabotagem que derruba tudo prova que a linha e
// viva, nao QUAL regra ela carrega -- registrado no `Board.test.tsx`.
// =====================================================================
describe("minhas-tarefas -- o kanban le colunas da API (fatia 4c-2)", () => {
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

    // ⚠️ Na vista de QUADRO os chips de filtro de coluna somem (eles sao da
    // vista de lista), entao "Em Andamento" aparece UMA vez: o cabecalho da
    // coluna. Medido -- a primeira versao deste teste esperava duas, herdando
    // a armadilha da 4b, que vale para a vista de LISTA.
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
   * ⚠️ O TESTE QUE SEPARA "le coluna" de "le status": a tarefa tem
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
    // Sobe do card ate a coluna. ⚠️ `[data-coluna]` e nao
    // `div[style*='min-width']`: o seletor por estilo casava com qualquer div
    // que mencionasse min-width, e em 21/08 o titulo do card ganhou
    // `minWidth: 0` -- o `closest` passou a achar o proprio titulo, e o teste
    // acusou "coluna errada" em vez de "seletor frouxo".
    const coluna = card.closest("[data-coluna]");
    expect(coluna?.textContent).toContain("Em Andamento");
    expect(coluna?.textContent).not.toContain("Concluído");
  });

  /**
   * ⚠️ MAIS PROVAVEL AQUI QUE NO `Board.tsx`: esta tela junta tarefas de
   * QUALQUER quadro e desenha as colunas do quadro GERAL. No dia do quadro
   * interno, tarefa de subtime cai exatamente neste contador.
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

// =====================================================================
// FATIA 5b-5b -- tarefa que mora em OUTRO quadro.
//
// ⚠️ NENHUM DESTES CASOS EXISTE EM PRODUCAO AINDA. O primeiro quadro
// nao-padrao nasce na 5b-6, e esta fatia e pre-requisito dela: no minuto em
// que existir uma tarefa fora do Quadro geral, esta tela e a primeira a
// mostra-la. Sem o que estes testes trancam, ela some -- e some CALADA na
// vista de lista.
//
// SABOTAGENS (executar antes de commitar):
//   A. Em `page.tsx`, no filtro `filtrados`, voltar para
//          const okStatus = colunasOn === null || colunasOn.has(t.column_id);
//      -> some da LISTA. Cai "a tarefa de quadro avulso aparece na LISTA".
//   B. No agrupamento `porColuna`, voltar para `map[t.column_id]`
//      -> volta para o contador. Cai "o card de quadro avulso e DESENHADO no
//      kanban" e "a tag do card diz o quadro e a coluna de origem".
//   C. Em `colunaDe`, trocar `posicaoDaTarefa.get(t.id)?.origem.coluna` por
//      `colunaPorId.get(t.column_id)` -> o alerta de prazo morre. Cai
//      "o alerta de prazo sobrevive".
//   D. Em `colunaDe`, usar `colunaDaTela` no lugar de `origem.coluna`
//      -> o alerta passa a sair da coluna equivalente. Cai "coluna com
//      notify_deadline false NAO ganha alerta".
// =====================================================================
describe("minhas-tarefas -- tarefa de outro quadro (fatia 5b-5b)", () => {
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
    // ⚠️ A REGRESSAO MAIS GRAVE DAS QUATRO, porque e a unica sem contador
    // nenhum. O filtro de coluna da lista guarda ids do quadro GERAL; o
    // `column_id` desta tarefa nunca esta neles, e ela era descartada em
    // silencio -- sem aviso, sem numero, sem log.
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
    // Antes desta fatia o card caia no `foraDaColuna`: contado e invisivel.
    // `Em Revisão` e `IN_PROGRESS` sem alvo, entao o degrau 2 da ADR 0042 a
    // manda para `Em Andamento`, que E alvo no geral.
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
    // ⚠️ O comentario do `dueTone` dizia que sem coluna resolvida "o lado
    // seguro e nao alertar". Era verdade quando "sem coluna" significava dado
    // faltando; virou o lado que MATA o aviso quando passou a significar
    // "outro quadro". `Em Revisão` tem `notify_deadline: true`.
    montarApi([tarefaAvulsa({ due_date: "2020-01-01" })]);

    render(<MinhasTarefasPage />);
    await screen.findByText("Tarefa do Campanhas");

    expect(screen.getByText(/atrasad/i)).toBeTruthy();
  });

  it("⚠️ coluna com notify_deadline false NAO ganha alerta pela equivalente", async () => {
    // ⚠️ O DEFEITO ESPELHO DO ANTERIOR, e o motivo de haver DUAS colunas por
    // card. `Aguardando cliente` nao avisa prazo; a equivalente dela no geral
    // (`Em Andamento`) avisa. Ler a coluna errada daria um alerta que a pessoa
    // que criou a coluna desligou de proposito.
    montarApi([
      tarefaAvulsa({ column_id: "av-espera", due_date: "2020-01-01" }),
    ]);

    render(<MinhasTarefasPage />);
    await screen.findByText("Tarefa do Campanhas");

    expect(screen.queryByText(/atrasad/i)).toBeNull();
  });
});
