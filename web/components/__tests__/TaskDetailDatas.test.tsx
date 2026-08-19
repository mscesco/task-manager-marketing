// Spec 038, fatia A -- a cápsula "Datas" no detalhe da tarefa.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE, E O QUE ELE **NÃO** COBRE. O corpo que sai no
// `POST /tasks` é prendido em `lib/__tests__/createTaskCorpo.test.ts`, e não
// aqui: este arquivo mocka `@/lib/api`, então ele afirma o que o componente
// CHAMA, e nunca o que viaja no fio. A distinção não é acadêmica -- foi
// exatamente ela que deixou o `board_id` fora do corpo por um mês com os três
// portões verdes, e está escrita no topo daquele arquivo.
//
// O que ELE prende:
//   - a pílula aparece MESMO SEM DATA (senão não há onde clicar para pôr uma);
//   - o painel manda os DOIS campos, sempre (o backend valida o par final);
//   - `""` vira `null`, e não string vazia;
//   - abrir e salvar sem mudar nada NÃO chama a API;
//   - o 422 do backend aparece na tela com a mensagem DELE;
//   - o pai é avisado (`onTaskMoved`), senão a cor de prazo do card fica velha.
//
// SABOTAGENS previstas:
//   A. Voltar a `{task.due_date && …}` na pílula. **Cai 1**: "aparece sem data".
//   B. Mandar só o campo que mudou. **Cai 1**: "manda os dois sempre".
//   C. Trocar `|| null` por `|| ""`. **Cai 1**: "vazio vira null".
//   D. Tirar o `onTaskMoved`. **Cai 1**: o card ficaria com a cor velha.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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

function task(over: Partial<Task> = {}): Task {
  // ⚠️ `): Task {` literal completo, SEM `as`. Fixture com `as` cala o `tsc`
  // sobre campo que não existe -- e foi assim que `start_date` ficou fora do
  // tipo `Task` do front enquanto o backend já o servia.
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

function montar(over: Partial<Task> = {}, onTaskMoved = vi.fn()) {
  render(
    <TaskDetail
      task={task(over)}
      members={new Map()}
      projects={new Map()}
      filhos={[]}
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

async function abrirPainel() {
  fireEvent.click(await screen.findByLabelText(/(Definir|Mudar) datas/));
  return {
    inicio: screen.getByLabelText("Data de início") as HTMLInputElement,
    prazo: screen.getByLabelText("Data de entrega") as HTMLInputElement,
  };
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

describe("TaskDetail -- a cápsula de datas (Spec 038, fatia A)", () => {
  it("⚠️ a pílula aparece MESMO SEM DATA -- sabotagem A", async () => {
    // ⚠️ Antes era `{task.due_date && …}`: sem prazo não havia pílula, e sem
    // pílula não haveria onde clicar para PÔR um. O vazio é um estado da
    // mesma caixa, e não a ausência dela -- mesma lição do "nenhum" do projeto.
    montar();
    expect(await screen.findByText(/Sem datas/)).toBeTruthy();
    expect(screen.getByLabelText("Definir datas")).toBeTruthy();
  });

  it("⚠️ SUBTAREFA também tem datas -- e é diferente do projeto", async () => {
    // ⚠️ O CONTROLE DE PROJETO É TRAVADO EM TAREFA DE TOPO porque subtarefa
    // HERDA o projeto do pai (Spec 022): não há o que editar. Data não é
    // herdada -- a subtarefa tem prazo próprio, e o `TaskDetail` já o desenha
    // na checklist e já o pede na criação rápida de subtarefa.
    //
    // A primeira versão desta fatia copiou o `ehTopo` do projeto sem pensar, e
    // a Camila pegou na tela no mesmo dia. Este teste é o que impede a trava
    // de voltar de carona numa refatoração do bloco vizinho.
    montar({ parent_task_id: "pai", path: "pai.t1", depth: 1 });
    expect(await screen.findByLabelText("Definir datas")).toBeTruthy();
  });

  it("⚠️ o painel se anuncia como \"Datas\"", async () => {
    // ⚠️ ESTAVA NO DESENHO E FOI OMITIDO na primeira entrega. Sem o título, o
    // painel é dois campos soltos ancorados num "+": nada diz do que ele é.
    montar();
    await abrirPainel();
    expect(screen.getByText("Datas")).toBeTruthy();
  });

  it("com prazo, mostra a data; com início, mostra os dois", async () => {
    montar({ due_date: "2026-08-19", start_date: "2026-08-01" });
    expect(await screen.findByText(/19\/08\/2026/)).toBeTruthy();
    expect(screen.getByText(/início 01\/08\/2026/)).toBeTruthy();
  });

  it("o painel abre com os valores ATUAIS preenchidos", async () => {
    montar({ due_date: "2026-08-19", start_date: "2026-08-01" });
    const { inicio, prazo } = await abrirPainel();
    expect(inicio.value).toBe("2026-08-01");
    expect(prazo.value).toBe("2026-08-19");
  });

  it("⚠️ manda os DOIS campos, sempre -- sabotagem B", async () => {
    // ⚠️ O backend valida `start_date <= due_date` sobre o estado FINAL da
    // tarefa (`_validate_dates`). Mandando só o campo que mudou, o par pode
    // ficar inválido com o valor que já estava no banco -- e a recusa falaria
    // de um campo que a pessoa não tocou.
    vi.mocked(api.updateTask).mockResolvedValue(
      task({ start_date: "2026-08-01", due_date: "2026-08-19" })
    );
    montar({ due_date: "2026-08-19" });
    const { inicio } = await abrirPainel();
    fireEvent.change(inicio, { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.updateTask)).toHaveBeenCalledWith("t1", {
        start_date: "2026-08-01",
        due_date: "2026-08-19",
        due_time: null,
      })
    );
  });

  it("⚠️ campo limpo vira null, e não string vazia -- sabotagem C", async () => {
    // `""` não é data: o backend responderia 422 por um gesto que significa
    // "apagar". `null` é o que o `fields_set` entende como apagar.
    vi.mocked(api.updateTask).mockResolvedValue(task());
    montar({ due_date: "2026-08-19" });
    const { prazo } = await abrirPainel();
    fireEvent.change(prazo, { target: { value: "" } });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.updateTask)).toHaveBeenCalledWith("t1", {
        start_date: null,
        due_date: null,
        due_time: null,
      })
    );
  });

  it("abrir e salvar SEM mudar nada não chama a API", async () => {
    // Uma entrada de histórico que não aconteceu do ponto de vista de quem usa
    // é pior que nenhuma -- mesma decisão do renomear de coluna.
    montar({ due_date: "2026-08-19" });
    await abrirPainel();
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Data de entrega")).toBeNull()
    );
    expect(vi.mocked(api.updateTask)).not.toHaveBeenCalled();
  });

  it("⚠️ o 422 aparece com a mensagem DO BACKEND", async () => {
    // ⚠️ É a única recusa que a pessoa consegue consertar sozinha, e o texto
    // certo ("início não pode ser posterior") só o backend sabe montar. Texto
    // fixo aqui esconderia a causa.
    vi.mocked(api.updateTask).mockRejectedValue(
      Object.assign(new Error(), {
        status: 422,
        message: "Data de inicio nao pode ser posterior a data limite.",
      })
    );
    montar({ due_date: "2026-08-01" });
    const { inicio } = await abrirPainel();
    fireEvent.change(inicio, { target: { value: "2026-08-19" } });
    fireEvent.click(screen.getByText("Salvar"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Data de inicio nao pode ser posterior"
    );
    // ⚠️ E O PAINEL FICA ABERTO: fechar com o valor recusado deixaria a tela
    // mostrando um estado que o servidor não aceitou.
    expect(screen.getByLabelText("Data de início")).toBeTruthy();
  });

  it("⚠️ avisa o pai depois de salvar -- sabotagem D", async () => {
    // Prazo muda a COR do card e o filtro "Atrasadas" do quadro. Sem avisar, a
    // tarefa fica com data nova no detalhe e cor velha atrás dele.
    const salva = task({ due_date: "2026-09-01" });
    vi.mocked(api.updateTask).mockResolvedValue(salva);
    const { onTaskMoved } = montar({ due_date: "2026-08-19" });
    const { prazo } = await abrirPainel();
    fireEvent.change(prazo, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() => expect(onTaskMoved).toHaveBeenCalledWith(salva));
  });
});

describe("TaskDetail -- a hora do prazo (Spec 038, fatia B)", () => {
  it("⚠️ o campo de hora SÓ aparece quando há data", async () => {
    // ⚠️ Hora sem data é recusada com 422 pelo backend (`_validate_hora`).
    // Esconder é mais forte que aceitar e recusar depois: a pessoa não chega a
    // digitar algo que não pode existir.
    montar();
    await abrirPainel();
    expect(screen.queryByLabelText(/Hora/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Data de entrega"), {
      target: { value: "2026-08-19" },
    });
    expect(screen.getByLabelText(/Hora/)).toBeTruthy();
  });

  it("manda a hora junto com a data", async () => {
    vi.mocked(api.updateTask).mockResolvedValue(
      task({ due_date: "2026-08-19", due_time: "18:00:00" })
    );
    montar({ due_date: "2026-08-19" });
    await abrirPainel();
    fireEvent.change(screen.getByLabelText(/Hora/), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.updateTask)).toHaveBeenCalledWith("t1", {
        start_date: null,
        due_date: "2026-08-19",
        due_time: "18:00",
      })
    );
  });

  it("⚠️ limpar a DATA limpa a HORA junto, e não manda o par proibido", async () => {
    // ⚠️ O backend recusa hora sem data com 422 -- e a mensagem falaria de um
    // campo que a pessoa não tocou. A tela desfaz a combinação antes de mandar.
    vi.mocked(api.updateTask).mockResolvedValue(task());
    montar({ due_date: "2026-08-19", due_time: "18:00:00" });
    await abrirPainel();
    fireEvent.change(screen.getByLabelText("Data de entrega"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.updateTask)).toHaveBeenCalledWith("t1", {
        start_date: null,
        due_date: null,
        due_time: null,
      })
    );
  });

  it("⚠️ o campo abre em HH:MM, e o backend devolve HH:MM:SS", async () => {
    // ⚠️ Um `<input type="time">` com valor de 8 caracteres fica VAZIO no
    // navegador -- a hora sumiria ao reabrir o painel, parecendo que não salvou.
    montar({ due_date: "2026-08-19", due_time: "18:30:00" });
    await abrirPainel();
    expect((screen.getByLabelText(/Hora/) as HTMLInputElement).value).toBe(
      "18:30"
    );
  });

  it("a pílula mostra a hora ao lado da data, sem os segundos", async () => {
    montar({ due_date: "2026-08-19", due_time: "18:30:00" });
    const gatilho = await screen.findByLabelText(/Mudar datas/);
    expect(gatilho.textContent).toContain("19/08/2026");
    expect(gatilho.textContent).toContain("18:30");
    expect(gatilho.textContent).not.toContain("18:30:00");
  });
});
