// Spec 039, F6-c -- a pílula de PROJETO na linha de pílulas.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. Em 22/08 a Camila viu na tela que a cápsula
// de projeto não estava onde o desenho dela sempre a pôs -- ao lado de Coluna,
// Prioridade e Datas. Ela morava na faixa de metadados abaixo, com o rótulo
// "Projeto" ao lado e um lápis separado da pílula.
//
// ⚠️⚠️ E O QUE ESTE ARQUIVO REALMENTE REGISTRA É OUTRA COISA: **mover a
// cápsula inteira de lugar, trocar o rótulo e fundir dois controles em um não
// derrubou NENHUM dos 895 testes.** A busca por "Sem Projeto", "nenhum" e
// "Mudar projeto" nos testes de componente voltou vazia. Um controle que
// escreve no banco (`POST /tasks/{id}/move`) estava sem portão nenhum -- e por
// isso este arquivo cobre o COMPORTAMENTO, e não a posição.
//
// O que ele prende:
//   - a pílula existe SEM projeto, e diz "Sem Projeto" (não "nenhum" solto);
//   - com projeto, ela diz o NOME dele;
//   - a pílula É o gatilho -- um alvo, não pílula + lápis;
//   - ⚠️ SUBTAREFA não edita (herda do pai, Spec 022): selo morto, sem botão;
//   - escolher manda `moveTask` com `project_id`, e TIRAR manda
//     `detach_project` -- não `project_id: null`.
//
// SABOTAGENS -- ✅ MEDIDAS EM 22/08/2026 (ver o commit).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Task } from "@/lib/api";

// ⚠️ `importOriginal`, e não fábrica seca: `@/lib/api` tem ~40 exports e o
// `TaskDetail` importa muitos. Mesmo motivo registrado no `Board.test.tsx`.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    colunasDoQuadro: vi.fn(),
    listarFilhas: vi.fn(),
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    listComments: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
  };
});

const api = await import("@/lib/api");

const QUADRO = "board-geral";

const COLUNAS: Coluna[] = [
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
];

const PROJETOS = new Map([
  ["p-vestibular", "Vestibular 2027"],
  ["p-marca", "Marca"],
]);

function task(over: Partial<Task> = {}): Task {
  // ⚠️ `): Task {` literal completo, SEM `as`. Fixture com `as` cala o `tsc`
  // sobre campo que não existe.
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
    team_id: "team-marketing",
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: "user-1",
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    assignee_ids: [],
    board_id: QUADRO,
    column_id: "col-backlog",
    ...over,
  };
}

function montar(over: Partial<Task> = {}) {
  const onTaskMoved = vi.fn();
  render(
    <TaskDetail
      task={task(over)}
      members={new Map()}
      projects={PROJETOS}
      temVoltar={false}
      onVoltar={vi.fn()}
      onClose={vi.fn()}
      onEditar={vi.fn()}
      onDuplicar={vi.fn()}
      onAssigneesChange={vi.fn()}
      onAbrirSubtarefa={vi.fn()}
      onSubtaskUpsert={vi.fn()}
      onTaskMoved={onTaskMoved}
      onExcluir={vi.fn()}
      mostrarArquivadas={false}
      projetosPessoais={new Set()}
      membrosInativos={new Set()}
      subtimePorMembro={new Map()}
      rootTeamId={"team-marketing"}
    />
  );
  return { onTaskMoved };
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
  vi.mocked(api.listarFilhas).mockResolvedValue([]);
  vi.mocked(api.listComments).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.currentUser).mockResolvedValue(null as never);
  vi.mocked(api.listMembersDoTime).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.getRootTeamId).mockResolvedValue("team-marketing");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDetail -- a pílula de projeto (Spec 039, F6-c)", () => {
  it("⚠️ sem projeto, a pílula diz \"Sem Projeto\" -- e não \"nenhum\"", async () => {
    // ⚠️ O RÓTULO IMPORTA PORQUE O CONTEXTO MUDOU. Na faixa de metadados havia
    // um "Projeto" escrito ao lado, então "nenhum" bastava. Na linha de
    // pílulas não há rótulo nenhum: as vizinhas se explicam sozinhas
    // ("Backlog", "Alta", a data), e um "nenhum" solto ao lado de uma data não
    // diz de que ele é nenhum. Mesma forma de "Sem datas".
    montar();
    expect(await screen.findByText("Sem Projeto")).toBeTruthy();
    expect(screen.queryByText("nenhum")).toBeNull();
  });

  it("com projeto, a pílula diz o nome dele", async () => {
    montar({ project_id: "p-vestibular" });
    expect(await screen.findByText("Vestibular 2027")).toBeTruthy();
  });

  it("⚠️ a PÍLULA é o gatilho -- um alvo, e não pílula + lápis", async () => {
    // Antes eram dois elementos: um `<span>` com o nome e, ao lado, um botão
    // de 26px com o lápis. Clicar no nome não fazia nada. É o mesmo defeito
    // que a F6-a corrigiu na prioridade.
    montar();
    const gatilho = await screen.findByTitle("Adicionar a um projeto");
    // O texto está DENTRO do gatilho, e não ao lado dele.
    expect(gatilho.textContent).toContain("Sem Projeto");
    expect(gatilho.tagName).toBe("BUTTON");
  });

  it("⚠️ SUBTAREFA não edita o projeto -- herda do pai (Spec 022)", async () => {
    // ⚠️ E ISTO É DIFERENTE DAS DATAS, de propósito: subtarefa TEM prazo
    // próprio e o edita. Copiar esta trava para as datas foi um engano real,
    // pego pela Camila na tela em 18/08 e prendido no `TaskDetailDatas`. Os
    // dois testes apontam para lados OPOSTOS -- é assim que a diferença
    // sobrevive a uma refatoração do bloco vizinho.
    montar({ parent_task_id: "pai", path: "pai.t1", depth: 1 });
    // O selo continua na tela: a pessoa precisa VER de qual projeto é.
    expect(await screen.findByText("Sem Projeto")).toBeTruthy();
    // Mas não há gatilho nenhum.
    expect(screen.queryByTitle("Adicionar a um projeto")).toBeNull();
    expect(screen.queryByTitle("Mudar projeto")).toBeNull();
  });

  it("escolher no seletor manda `project_id` -- e é `moveTask`, não `updateTask`", async () => {
    // ⚠️ EU ESCREVI ESTE TESTE CONTRA `updateTask` E ELE FALHOU. Trocar de
    // projeto não é um PATCH de campo: é `moveTask`, rota própria, porque
    // mover arrasta a subárvore junto e o backend valida alcance. Registro o
    // erro em vez de apagá-lo -- é a mesma suposição que o §8.1 da spec
    // descreve, agora numa chamada de API em vez de num escopo de fatia.
    vi.mocked(api.moveTask).mockResolvedValue(task({ project_id: "p-marca" }));
    const { onTaskMoved } = montar();

    fireEvent.click(await screen.findByTitle("Adicionar a um projeto"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "p-marca" },
    });

    await waitFor(() => {
      expect(api.moveTask).toHaveBeenCalledWith("t1", { project_id: "p-marca" });
    });
    // O pai PRECISA saber: no quadro ele reagrupa, em `/minhas-tarefas` ele
    // faz upsert. Sem isso o card fica no projeto antigo até um F5.
    expect(onTaskMoved).toHaveBeenCalled();
  });

  it("⚠️ TIRAR do projeto manda `detach_project`, e não `project_id: null`", async () => {
    // ⚠️ São rotas com semânticas diferentes no backend, e `null` num campo
    // opcional é ambíguo: "não mexe" ou "esvazia"? O `detach_project` diz uma
    // coisa só. Este é o caminho que a pessoa usa para desfazer um engano, e
    // ele não tinha portão.
    vi.mocked(api.moveTask).mockResolvedValue(task({ project_id: null }));
    montar({ project_id: "p-vestibular" });

    fireEvent.click(await screen.findByTitle("Mudar projeto"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

    await waitFor(() => {
      expect(api.moveTask).toHaveBeenCalledWith("t1", { detach_project: true });
    });
  });

  it("escolher o projeto em que ela JÁ está não chama a API", async () => {
    montar({ project_id: "p-vestibular" });
    fireEvent.click(await screen.findByTitle("Mudar projeto"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "p-vestibular" },
    });
    expect(api.moveTask).not.toHaveBeenCalled();
  });
});
