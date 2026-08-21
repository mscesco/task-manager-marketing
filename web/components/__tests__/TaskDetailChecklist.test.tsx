// Spec 036, fatia 4c-2 -- a checklist do DETALHE decide pela COLUNA.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. Em 10/08 a fatia 4c-1 migrou o contador do
// CARD para a coluna e deixou o do DETALHE lendo `status`. Resultado, achado
// na conferencia manual e por nenhum portao: o card dizia "2/2" e o detalhe da
// MESMA tarefa dizia "(0/2)" com a barra em 0%. Dois numeros discordando sobre
// a mesma coisa e pior que um numero velho.
//
// O que ele prende:
//   - a CONTA (`lib/subtarefas.ts::progresso`) sai da coluna;
//   - a MARCA da caixinha sai da coluna;
//   - a ESCRITA da caixinha manda `column_id`, e nao `status` (ADR 0041);
//   - desmarcar devolve a coluna de ANTES, e nao a primeira coluna aberta;
//   - enquanto as colunas nao chegam, nao ha numero -- e nao um numero errado.
//
// SABOTAGENS -- ✅ MEDIDAS EM 10/08/2026:
//
//   A. `progresso` volta a contar `status === "COMPLETED"`.
//      **Caem 11**: tres deste arquivo (a conta, a marca da caixinha e a
//      guarda de carregamento) e oito do `lib/__tests__/subtarefas.test.ts`.
//      ⚠️ Numero alto porque a regra e UMA e e lida por quatro telas -- e
//      exatamente por isso ela mora numa funcao pura com teste proprio.
//
//   G. Badge volta a `STATUS_LABEL[task.status]`. **Cai 1**: "mostra o nome da
//      coluna, e não o rótulo do status".
//   H. Badge SEM a reserva (so `coluna?.name`). **Cai 1**: "coluna
//      desconhecida cai no rótulo do status, e não em branco". ⚠️ Os dois
//      testes do badge apontam para lados OPOSTOS de propósito -- um exige a
//      coluna, o outro exige a reserva. Sabotar um so nao derruba o outro.
//
//   C. `alvo()` para de olhar `is_default_target` e pega a primeira coluna da
//      semantica. **Caem 2**, os dois de desmarcar.
//      ⚠️ ESTA SABOTAGEM PASSOU VERDE NA PRIMEIRA TENTATIVA: a fixture tinha
//      `Backlog` como primeira POR POSICAO e tambem como alvo padrao, entao a
//      regra certa e a errada davam a mesma resposta. A ordem foi invertida
//      (`Planejado` primeiro) so para o teste discriminar. **Acidente nao e
//      regra**, e sabotagem verde e como se descobre.
//
//   B. A caixinha volta a mandar `{ status }` no lugar de `{ column_id }`.
//      **Caem 2**, os dois de ESCRITA: "marcar manda `column_id`, e NUNCA
//      `status`" e "desmarcar devolve a coluna de ANTES". Os tres de LEITURA
//      continuam verdes, e isso e informacao: leitura e escrita tem portoes
//      separados, entao migrar uma e esquecer a outra nao passa despercebido.
//
// ⚠️ O QUE ELE NAO PROVA: as outras tres telas que montam o `TaskDetail`
// (`/minhas-tarefas`, `/arquivadas`, `/tarefa/[id]`). Elas ganharam o
// comportamento de graca, porque quem carrega as colunas e o proprio
// componente -- mas nenhuma delas tem teste de montagem aqui.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Task } from "@/lib/api";

// ⚠️ `importOriginal`, e nao fabrica seca: `@/lib/api` tem ~40 exports e o
// `TaskDetail` importa muitos. Mesmo motivo registrado no `Board.test.tsx`.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    colunasDoQuadro: vi.fn(),
    // ⚠️ SPEC 042 (B1): o painel busca as proprias filhas. Ate aqui elas
    // vinham por prop e o `Pai` deste arquivo guardava o estado -- era ele que
    // fazia a caixinha refletir na tela. Agora quem faz isso e o
    // `upsertFilhaLocal` do proprio componente, e e esse comportamento que os
    // testes de marcar/desmarcar passam a exercitar.
    listarFilhas: vi.fn(),
    updateTask: vi.fn(),
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
  // ⚠️ A ORDEM ESTA INVERTIDA DE PROPOSITO: `Planejado` vem PRIMEIRO por
  // posicao, e `Backlog` e o alvo padrao. Sem isso, "pegar a primeira aberta"
  // e "pegar a marcada como padrao" dariam a MESMA resposta, e a sabotagem que
  // apaga o `is_default_target` passaria verde -- foi o que aconteceu na
  // primeira versao deste arquivo. Acidente nao e regra.
  {
    id: "col-planejado",
    name: "Planejado",
    color: "var(--status-planned-dot)",
    position: 0,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: false,
    is_status_bridge: false,
  },
  {
    id: "col-backlog",
    name: "Backlog",
    color: "var(--status-backlog-dot)",
    position: 1,
    semantic: "OPEN",
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
];

function task(over: Partial<Task> = {}): Task {
  // ⚠️ `): Task {` e literal completo, SEM `as`. Fixture com `as` cala o `tsc`
  // sobre campo que nao existe -- foi o que escondeu o buraco da fatia 3 por
  // horas.
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

/**
 * ⚠️ O PAI GUARDA OS FILHOS EM ESTADO, e isso nao e detalhe de teste: sem
 * aplicar o `onSubtaskUpsert`, a subtarefa nunca muda de coluna e qualquer
 * teste com DOIS cliques mede o primeiro duas vezes. Foi o que aconteceu na
 * primeira versao deste arquivo.
 */
function Pai({
  inicial,
  onSubtaskUpsert,
  tarefa,
  members,
}: {
  inicial: Task[];
  onSubtaskUpsert?: (sub: Task) => void;
  // Só os testes de responsável precisam; os demais seguem com o mapa vazio.
  members?: Map<string, { name: string }>;
  // A tarefa FOCADA. Default = a mae generica; os testes do badge passam uma
  // com coluna especifica.
  tarefa?: Task;
}) {
  // ⚠️ B1: `inicial` agora chega pelo MOCK de `listarFilhas` (ver `montar`),
  // e nao mais por prop. O estado local sumiu junto -- quem reflete a
  // caixinha na tela passou a ser o `upsertFilhaLocal` do `TaskDetail`, e e
  // isso que estes testes verificam agora.
  void inicial;
  return (
    <TaskDetail
      task={tarefa ?? task({ id: "pai", title: "Tarefa mãe", path: "pai" })}
      members={members ?? new Map()}
      projects={new Map()}
      temVoltar={false}
      onVoltar={vi.fn()}
      onClose={vi.fn()}
      onEditar={vi.fn()}
      onDuplicar={vi.fn()}
      onAssigneesChange={vi.fn()}
      onAbrirSubtarefa={vi.fn()}
      onSubtaskUpsert={(sub) => {
        onSubtaskUpsert?.(sub);
      }}
      onTaskMoved={vi.fn()}
      onExcluir={vi.fn()}
      mostrarArquivadas={false}
      projetosPessoais={new Set()}
      membrosInativos={new Set()}
      subtimePorMembro={new Map()}
      rootTeamId={"team-marketing"}
    />
  );
}

function montar(
  filhos: Task[],
  onSubtaskUpsert?: (sub: Task) => void,
  members?: Map<string, { name: string }>
) {
  // ⚠️ B1: as filhas entram pelo mock da busca, e nao por prop.
  vi.mocked(api.listarFilhas).mockResolvedValue(filhos);
  render(
    <Pai
      inicial={filhos}
      onSubtaskUpsert={onSubtaskUpsert}
      members={members}
    />
  );
}

beforeEach(() => {
  vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
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

describe("TaskDetail -- a checklist conta pela coluna (fatia 4c-2)", () => {
  it("conta pela COLUNA mesmo com o status dizendo outra coisa", async () => {
    // ⚠️ O PAR TORTO, e ele e o estado REAL da tela logo depois de arrastar o
    // pai para conclusao: a atualizacao otimista move a coluna e o `status` so
    // chega na resposta. Contando por status, isto daria "(0/1)" e 0%.
    montar([
      task({
        id: "f1",
        title: "Filha",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        status: "BACKLOG",
        column_id: "col-done",
      }),
    ]);

    expect(await screen.findByText(/Subtarefas \(1\/1\)/)).toBeTruthy();
    expect(
      screen.getByLabelText("1 de 1 subtarefas concluídas (100%)")
    ).toBeTruthy();
  });

  it("a caixinha aparece marcada pela coluna", async () => {
    montar([
      task({
        id: "f1",
        title: "Filha pronta",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        status: "BACKLOG",
        column_id: "col-done",
      }),
    ]);
    await screen.findByText(/Subtarefas \(1\/1\)/);

    // ⚠️ Se a marca sair de `status`, a caixa fica DESmarcada com a barra em
    // 100% -- os dois numeros discordando dentro da MESMA tela.
    expect(
      (screen.getByTitle("Reabrir") as HTMLInputElement).checked
    ).toBe(true);
  });

  it("⚠️ concluir a subtarefa NAO pode apagar o responsavel dela", async () => {
    // ⚠️ DEFEITO REAL, RELATADO NA TELA EM 21/08/2026: marcar a caixinha fazia
    // a bolinha do responsavel SUMIR da linha, e um F5 a trazia de volta.
    //
    // Causa: `upsertFilhaLocal` (nascido na B1) substituia a filha pela
    // resposta crua do `PATCH`. E `PATCH /tasks/{id}` responde `TaskResponse`,
    // que NAO tem `assignee_ids` (ADR 0025) -- o campo era apagado da memoria
    // e voltava so no proximo `listarFilhas`.
    //
    // ⚠️ E A QUARTA ENCARNACAO DO MESMO DEFEITO. O `aoUpsert` do quadro tem o
    // `?? existente.assignee_ids` exatamente por isso; a B1 mudou a lista de
    // lugar e deixou a guarda para tras.
    //
    // ⚠️ POR QUE NENHUM TESTE PEGOU: os outros mocks de `updateTask` neste
    // arquivo fazem `{...f, ...}` e por isso devolvem `assignee_ids` -- eles
    // sao MAIS GENEROSOS QUE O SERVIDOR. Este mock imita o backend de verdade,
    // e e essa diferenca que transforma o teste em portao.
    const f = task({
      id: "f1",
      title: "Filha com responsável",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
      assignee_ids: ["u1"],
    });
    const { assignee_ids: _semEsteCampo, ...comoOBackendResponde } = f;
    vi.mocked(api.updateTask).mockResolvedValue({
      ...comoOBackendResponde,
      column_id: "col-done",
      status: "COMPLETED",
    } as Task);

    montar([f], undefined, new Map([["u1", { name: "Ana" }]]));
    await screen.findByTitle("Ana");

    fireEvent.click(screen.getByTitle("Concluir"));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());

    // A bolinha tem de continuar la DEPOIS que a resposta do PATCH chega.
    expect(screen.getByTitle("Ana")).toBeTruthy();
  });

  it("marcar manda `column_id`, e NUNCA `status`", async () => {
    const f = task({
      id: "f1",
      title: "Filha aberta",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
    });
    vi.mocked(api.updateTask).mockResolvedValue({
      ...f,
      column_id: "col-done",
      status: "COMPLETED",
    });
    montar([f]);
    await screen.findByText(/Subtarefas \(0\/1\)/);

    fireEvent.click(screen.getByTitle("Concluir"));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("f1", {
        column_id: "col-done",
      });
    });
    // ⚠️ O payload tem UMA chave. Mandar `status` junto e 422 no backend
    // (ADR 0041, D3), e mandar `status` no lugar seria a regra velha.
    const payload = vi.mocked(api.updateTask).mock.calls[0][1];
    expect(Object.keys(payload)).toEqual(["column_id"]);
  });

  /**
   * ⚠️ REGRA UNICA, e ela substitui uma memoria que a conferencia manual de
   * 10/08 reprovou. A versao anterior guardava de onde a subtarefa saiu e
   * devolvia para la -- so que a memoria morria ao fechar o detalhe, entao o
   * MESMO clique dava respostas diferentes dependendo de a pessoa ter
   * conferido o quadro no meio. Duas respostas para o mesmo gesto, sem nada
   * na tela explicando.
   *
   * ⚠️ Nao e "a primeira coluna aberta": e a marcada como `is_default_target`.
   * `Planejado` esta ANTES de `Backlog`?  Nao -- mas a fixture tem as duas
   * abertas de proposito, e so a flag separa uma da outra. Ordenar por
   * `position` daria a mesma resposta por acidente, e acidente nao e regra.
   */
  it("desmarcar manda SEMPRE para a coluna aberta padrão", async () => {
    const f = task({
      id: "f1",
      title: "Filha pronta",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-done",
    });
    vi.mocked(api.updateTask).mockResolvedValue({ ...f, column_id: "col-backlog" });
    montar([f]);
    await screen.findByText(/Subtarefas \(1\/1\)/);

    fireEvent.click(screen.getByTitle("Reabrir"));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("f1", {
        column_id: "col-backlog",
      });
    });
  });

  /**
   * ⚠️ O CONTRAPESO DO TESTE ACIMA: marcar e desmarcar NAO devolve a
   * subtarefa para onde ela estava. E o preco da regra fixa, e esta escrito
   * como teste para que ninguem o "conserte" sem saber que foi escolhido.
   */
  it("marcar e desmarcar NÃO devolve para a coluna de origem", async () => {
    const f = task({
      id: "f1",
      title: "Filha planejada",
      parent_task_id: "pai",
      path: "pai.f1",
      depth: 1,
      column_id: "col-planejado",
    });
    vi.mocked(api.updateTask).mockImplementation(async (_id, corpo) => ({
      ...f,
      column_id: (corpo as { column_id: string }).column_id,
    }));
    montar([f]);
    await screen.findByText(/Subtarefas \(0\/1\)/);

    fireEvent.click(screen.getByTitle("Concluir"));
    await screen.findByTitle("Reabrir");
    fireEvent.click(screen.getByTitle("Reabrir"));

    await waitFor(() => {
      expect(vi.mocked(api.updateTask).mock.calls).toHaveLength(2);
    });
    expect(vi.mocked(api.updateTask).mock.calls[1][1]).toEqual({
      column_id: "col-backlog",
    });
  });

  it("sem as colunas não há número -- e a caixinha fica travada", async () => {
    let liberar!: (c: Coluna[]) => void;
    vi.mocked(api.colunasDoQuadro).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );
    montar([
      task({
        id: "f1",
        title: "Filha",
        parent_task_id: "pai",
        path: "pai.f1",
        depth: 1,
        column_id: "col-done",
      }),
    ]);

    // ⚠️ "Subtarefas" SEM "(x/y)". Com o mapa vazio a conta daria "(0/1)" --
    // que e exatamente o numero errado que a conferencia manual pegou.
    await screen.findByText("Subtarefas");
    expect(screen.queryByText(/Subtarefas \(/)).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
      true
    );

    liberar(COLUNAS);
    expect(await screen.findByText(/Subtarefas \(1\/1\)/)).toBeTruthy();
  });
});

// =====================================================================
// Fatia 4c-2 -- o BADGE do detalhe mostra o nome da COLUNA.
// =====================================================================
describe("TaskDetail -- o badge sai da coluna (fatia 4c-2)", () => {
  it("mostra o nome da coluna, e não o rótulo do status", async () => {
    render(
      <Pai
        inicial={[]}
        tarefa={task({
          id: "pai",
          title: "Mãe",
          path: "pai",
          // ⚠️ PAR TORTO: o status diz BACKLOG, a coluna e `Planejado`. Se o
          // badge sair do status, aparece "Backlog".
          status: "BACKLOG",
          column_id: "col-planejado",
        })}
      />
    );

    expect(await screen.findByText("Planejado")).toBeTruthy();
    expect(screen.queryByText("Backlog")).toBeNull();
  });

  /**
   * ⚠️ A RESERVA. Coluna fora da lista carregada (quadro sem alcance, coluna
   * apagada na fatia 5) cai no rotulo do status -- e nao em branco. Badge
   * vazio nao diz nada a ninguem.
   */
  it("coluna desconhecida cai no rótulo do status, e não em branco", async () => {
    render(
      <Pai
        inicial={[]}
        tarefa={task({
          id: "pai",
          title: "Mãe",
          path: "pai",
          status: "IN_PROGRESS",
          column_id: "col-de-outro-quadro",
        })}
      />
    );

    expect(await screen.findByText("Em Andamento")).toBeTruthy();
  });
});

// =====================================================================
// Spec 039 (F6) -- a pílula de PRIORIDADE virou o controle.
//
// ⚠️ Até aqui ela era rótulo morto: trocar um enum de quatro valores exigia
// abrir o modal inteiro pelo "Editar". É a mesma lição da C8 que a pílula de
// datas já aplicava ("a pílula VIROU o controle, e não ganhou um controle ao
// lado") -- a de prioridade tinha ficado para trás.
// =====================================================================
describe("TaskDetail -- a pílula de prioridade abre e grava (F6)", () => {
  it("clicar na pílula abre a lista com as quatro, na ordem do enum", async () => {
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));

    const lista = await screen.findByRole("listbox", { name: "Prioridade" });
    const opcoes = within(lista).getAllByRole("option");
    // ⚠️ SABOTAGEM MEDIDA (21/08): trocar a constante `PRIORIDADES` por
    // `Object.keys(PRIORITY_LABEL)` **NÃO derruba este teste** -- o objeto em
    // `lib/status.ts` está declarado justamente nessa ordem, então a regra
    // certa e a errada dão a mesma resposta hoje. É o mesmo tipo de acidente
    // que o caso C do cabeçalho deste arquivo registra.
    //
    // O que esta asserção prende, então, é MENOS do que parece: ela pega uma
    // reordenação da lista RENDERIZADA, não a origem dela. A constante
    // explícita continua sendo o certo (não depende da ordem de chaves de um
    // objeto distante), mas quem garante isso é o comentário lá, não este
    // teste. Ele viraria portão de verdade no dia em que `PRIORITY_LABEL`
    // fosse declarado fora de ordem -- e aí pegaria.
    expect(opcoes.map((o) => o.textContent)).toEqual([
      "Baixa",
      "Media",
      "Alta",
      "Urgente",
    ]);
  });

  it("escolher grava com `priority` e SÓ com ele", async () => {
    const salva = task({ id: "pai", title: "Tarefa mãe", path: "pai" });
    vi.mocked(api.updateTask).mockResolvedValue({ ...salva, priority: "URGENT" });
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));
    fireEvent.click(await screen.findByRole("option", { name: "Urgente" }));

    await waitFor(() => {
      expect(api.updateTask).toHaveBeenCalledWith("pai", { priority: "URGENT" });
    });
    // ⚠️ UMA CHAVE SÓ. O `updateTask` manda `body: input` inteiro, então
    // qualquer campo a mais viaja -- e mandar `status` junto seria a regra
    // velha que a ADR 0041 aposentou.
    const payload = vi.mocked(api.updateTask).mock.calls[0][1];
    expect(Object.keys(payload)).toEqual(["priority"]);
  });

  it("⚠️ escolher a MESMA prioridade não manda requisição", async () => {
    // Sem esta guarda, abrir a lista e clicar no que já está marcado gasta um
    // PATCH e uma linha de histórico para não mudar nada.
    montar([]);
    await screen.findByText(/Subtarefas/);

    fireEvent.click(screen.getByTitle("Mudar prioridade"));
    fireEvent.click(await screen.findByRole("option", { name: "Media" }));

    expect(api.updateTask).not.toHaveBeenCalled();
  });
});
