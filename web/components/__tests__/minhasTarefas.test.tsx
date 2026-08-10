/**
 * `/minhas-tarefas` -- teste de componente, escrito ANTES da fatia 4b.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A fatia 4 da Spec 036 troca `STATUSES` (const
 * sincrona) por colunas vindas da API, e `sondagem-fatia-4.md` mediu que esta
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

function item(
  over: Partial<MyTaskItem> & { id: string; title: string }
): MyTaskItem {
  return {
    workspace_id: "ws",
    project_id: null,
    parent_task_id: null,
    team_id: RAIZ,
    board_id: "board-geral",
    column_id: "col-backlog",
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
      item({ id: "t1", title: "Em andamento", status: "IN_PROGRESS" }),
      item({ id: "t2", title: "Ja concluida", status: "COMPLETED" }),
      item({ id: "t3", title: "Cancelada", status: "CANCELLED" }),
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
      item({ id: "t1", title: "Em andamento", status: "IN_PROGRESS" }),
      item({ id: "t2", title: "Ja concluida", status: "COMPLETED" }),
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
