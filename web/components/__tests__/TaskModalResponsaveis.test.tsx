// "Selecionar todos" e "Limpar" no seletor de responsáveis (22/08).
//
// ⚠️ POR QUE SÓ NA CRIAÇÃO, e isso é o assunto do arquivo. A Camila pediu os
// dois botões e eu levantei o custo antes: no DETALHE da tarefa cada caixa
// marcada é uma requisição imediata (`addAssignee`), e cada designação dispara
// uma notificação "Designada" -- num time de ~26 pessoas, um clique viraria 26
// requisições e 25 avisos. Aqui a seleção é LOCAL até o "Criar". Decisão dela,
// com as palavras dela: "quero no criar só".
//
// O que ele prende:
//   - os botões existem na CRIAÇÃO;
//   - NÃO existem ao editar nem ao duplicar;
//   - "todos" age sobre os VISÍVEIS (a busca filtra), e SOMA à seleção;
//   - "limpar" zera;
//   - cada botão some quando não teria efeito.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import TaskModal from "@/components/TaskModal";
import type { Member, Task } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    createTask: vi.fn(),
    duplicateTask: vi.fn(),
    updateTask: vi.fn(),
    listProjects: vi.fn(),
    listMembers: vi.fn(),
    listMembersDoTime: vi.fn(),
    getRootTeamId: vi.fn(),
    colunasDoQuadro: vi.fn(),
  };
});

const api = await import("@/lib/api");

const RAIZ = "team-raiz";
const ANA = "u-ana";
const BRUNO = "u-bruno";
const CARLA = "u-carla";

function membro(id: string, name: string): Member {
  return {
    id,
    workspace_id: "ws",
    name,
    email: `${id}@x.com`,
    is_active: true,
    team_ids: [RAIZ],
  };
}

const TIME = [membro(ANA, "Ana"), membro(BRUNO, "Bruno"), membro(CARLA, "Carla")];

function task(over: Partial<Task> = {}): Task {
  // Literal completo, SEM `as` -- fixture com `as` cala o `tsc` sobre campo
  // que não existe.
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
    team_id: RAIZ,
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: ANA,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    assignee_ids: [],
    board_id: "board-geral",
    column_id: "col-backlog",
    // Spec 051, fatia A: o cadeado vem do servidor, em toda resposta.
    can_delete: true,
    ...over,
  };
}

function mocks() {
  vi.mocked(api.listMembers).mockResolvedValue(TIME);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(TIME);
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.colunasDoQuadro).mockResolvedValue([]);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
}

/** Abre o modal e o seletor de responsáveis, e devolve o painel. */
async function abrirSeletor(props: Record<string, unknown> = {}) {
  mocks();
  // ⚠️ `newTaskTeam={null}` ANTES do spread, de proposito: e o caminho LEGADO
  // (a tela nao sabe o time, o modal cai no `getRootTeamId()`), e os testes que
  // exercitam o caminho novo o sobrescrevem pelo `props`.
  render(
    <TaskModal
      open
      newTaskTeam={null}
      onClose={() => {}}
      onSaved={() => {}}
      {...props}
    />,
  );
  fireEvent.click(await screen.findByLabelText("Designar responsável"));
  return await screen.findByPlaceholderText("Buscar pessoa…");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskModal -- selecionar todos e limpar (criação)", () => {
  it("os dois botões existem na criação, e o de todos diz QUANTOS", async () => {
    await abrirSeletor();
    // ⚠️ O NÚMERO NO RÓTULO não é enfeite: ele é o que denuncia que o botão
    // age sobre os VISÍVEIS, e muda junto com a busca.
    expect(await screen.findByText("Selecionar todos (3)")).toBeTruthy();
    // "Limpar" ainda não: ninguém escolhido.
    expect(screen.queryByText("Limpar")).toBeNull();
  });

  it("selecionar todos marca os três e o botão some", async () => {
    await abrirSeletor();
    fireEvent.click(await screen.findByText("Selecionar todos (3)"));

    // ⚠️ A SELEÇÃO SE LÊ PELAS PÍLULAS, e não por um resumo "3 pessoas": o
    // modal desenha uma pílula com "Remover X" por escolhido. Eu tinha
    // escrito o teste contra um resumo que não existe aqui (ele é do seletor
    // de subtarefa) -- conferir o que a tela desenha vale mais que supor.
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Remover /).length).toBe(3);
    });
    // ⚠️ Some porque clicar de novo não faria nada -- afordância que não age é
    // pior que ausência.
    expect(screen.queryByText(/Selecionar todos/)).toBeNull();
    expect(screen.getByText("Limpar")).toBeTruthy();
  });

  it("⚠️ com busca, “todos” age só nos VISÍVEIS -- e SOMA, não substitui", async () => {
    // ⚠️ ESTE É O CASO QUE UM `setAssigneeIds(visiveis)` INGÊNUO QUEBRARIA:
    // escolher Carla, depois buscar "an" e clicar em "selecionar todos"
    // APAGARIA a Carla. Destruir seleção num botão chamado "selecionar" é o
    // oposto do que ele promete.
    const busca = await abrirSeletor();
    fireEvent.click(await screen.findByText("Carla"));

    fireEvent.change(busca, { target: { value: "an" } });
    // Só a Ana casa com "an".
    fireEvent.click(await screen.findByText("Selecionar todos (1)"));

    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Remover /).length).toBe(2);
    });
  });

  it("limpar zera a seleção", async () => {
    await abrirSeletor();
    fireEvent.click(await screen.findByText("Selecionar todos (3)"));
    await screen.findByText("Limpar");

    fireEvent.click(screen.getByText("Limpar"));

    await waitFor(() => {
      expect(screen.queryByText("Limpar")).toBeNull();
    });
    // E o de "todos" volta, porque voltou a ter o que selecionar.
    expect(screen.getByText("Selecionar todos (3)")).toBeTruthy();
  });

  it("⚠️ o painel é `fixed` -- senão o card do modal o RECORTA", async () => {
    // ⚠️ ESTE TESTE PRENDE POUCO, E DIZ ISSO. O card do modal tem
    // `maxHeight: 88vh` + `overflowY: auto`, e um filho `absolute` é recortado
    // por esse overflow: com o campo de Responsáveis perto do rodapé, o painel
    // abria cortado e era preciso rolar o modal para escolher alguém (relato
    // da Camila, 22/08, com print).
    //
    // jsdom não tem layout -- `getBoundingClientRect` volta zerado --, então
    // NÃO dá para provar aqui que ele deixou de ser recortado, nem que ele
    // vira para cima quando falta espaço. O que dá para prender é a escolha
    // que faz a diferença: `fixed`, e não `absolute`. Se alguém "arrumar" o
    // posicionamento voltando ao absoluto, isto cai.
    const busca = await abrirSeletor();
    const painel = busca.parentElement!;
    expect(painel.style.position).toBe("fixed");
  });

  // ⚠️ AQUI MORAVA "EDITAR não tem seletor NENHUM". O modo editar saiu do
  // modal na Spec 052 (fatia D): título, descrição e links se editam no
  // detalhe, e responsável sempre foi do detalhe.

  it("⚠️ DUPLICAR não tem os botões -- a lista dali é entrada do passo 2", async () => {
    // Na cópia os responsáveis já vêm REVISADOS da origem (ADR 0031), e o
    // passo 2 decide subtarefa por subtarefa a partir dessa lista. Um
    // "selecionar todos" aqui mexeria na entrada daquele fluxo.
    mocks();
    render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={task({ id: "origem", title: "Campanha", assignee_ids: [ANA] })}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByText("Duplicar tarefa");
    // Abre o seletor pelo resumo da seleção herdada.
    fireEvent.click(await screen.findByLabelText("Designar responsável"));
    expect(screen.queryByText(/Selecionar todos/)).toBeNull();
  });
});

// ⚠️⚠️ O DEFEITO DE 11/09, reportado na tela com duas capturas: no quadro geral
// de um time RAIZ o seletor de responsável oferecia a organização inteira --
// "responsáveis que não são nem desse time também".
//
// A cadeia: o `Board` mandava `null` (não há quadro avulso nem subtime), o
// modal caía no `getRootTeamId()` dele próprio, e essa função LEVANTA desde a
// Spec 046 quando existe mais de uma raiz. Sem raiz, sem `?reaches_team=`, sem
// filtro -- de volta ao "todo mundo" que a Spec 034 tirou.
//
// ⚠️ POR QUE NENHUM TESTE PEGOU: todos os daqui mockam `getRootTeamId` com
// `mockResolvedValue`. Com UMA raiz ela resolve, e o caminho de queda nunca é
// exercitado. O que faltava era o mock que REJEITA.
describe("TaskModal -- a raiz vem da tela, e não de um sorteio", () => {
  const OUTRA_RAIZ = "team-outra-raiz";
  const DEDE = "u-dede";

  /** Membro de OUTRO time raiz: `GET /members` o devolve, o time não. */
  function forasteiro(): Member {
    return {
      id: DEDE,
      workspace_id: "ws",
      name: "Dedé",
      email: "dede@x.com",
      is_active: true,
      team_ids: [OUTRA_RAIZ],
    };
  }

  function mocksComDuasRaizes() {
    mocks();
    // A organização inteira, o forasteiro incluído.
    vi.mocked(api.listMembers).mockResolvedValue([...TIME, forasteiro()]);
    // Quem alcança a RAIZ: só o time dela. É a resposta do backend.
    vi.mocked(api.listMembersDoTime).mockResolvedValue(TIME);
    // ⚠️ DUAS RAÍZES => `getRootTeamId` levanta (`soleRootTeam`).
    vi.mocked(api.getRootTeamId).mockRejectedValue(
      new Error("mais de uma raiz"),
    );
  }

  it("com a raiz na prop, o forasteiro NÃO é oferecido", async () => {
    mocksComDuasRaizes();
    render(
      <TaskModal
        open
        newTaskTeam={{ teamId: RAIZ, internal: false }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(await screen.findByLabelText("Designar responsável"));

    // O número no rótulo é o que denuncia: três, e não quatro.
    expect(await screen.findByText("Selecionar todos (3)")).toBeTruthy();
    expect(screen.queryByText("Dedé")).toBeNull();
    // E a pergunta foi feita para a raiz CERTA, sem passar pelo sorteio.
    expect(api.listMembersDoTime).toHaveBeenCalledWith(RAIZ);
  });

  it("⚠️ O SELETOR DE PROJETO CONTINUA NA TELA (a outra metade do defeito)", async () => {
    // ⚠️ Este é o teste que prende a separação. Enquanto o time da tarefa e o
    // "nasce interna" eram UMA prop (`defaultTeamId`), responder a raiz aqui
    // APAGAVA o seletor de projeto -- consertar um lado quebrava o outro.
    // Agora `teamId` responde escopo e `internal` responde seletor.
    mocksComDuasRaizes();
    render(
      <TaskModal
        open
        newTaskTeam={{ teamId: RAIZ, internal: false }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(await screen.findByLabelText(/^Projeto/)).toBeTruthy();
  });

  it("quadro de subtime: escopo do subtime E seletor de projeto escondido", async () => {
    mocksComDuasRaizes();
    const SUB = "team-sub";
    render(
      <TaskModal
        open
        newTaskTeam={{ teamId: SUB, internal: true }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByLabelText("Designar responsável");
    expect(api.listMembersDoTime).toHaveBeenCalledWith(SUB);
    expect(screen.queryByLabelText(/^Projeto/)).toBeNull();
  });

  it("caminho LEGADO (`newTaskTeam={null}`) segue sem filtro, de propósito", async () => {
    // ⚠️ ISTO NÃO É O DEFEITO SOBREVIVENDO: é `/quadro` sem time na URL, onde
    // ninguém sabe a raiz. Errar oferecendo demais devolve o comportamento
    // anterior, com o 422 do backend de pé; errar escondendo demais tira gente
    // do trabalho. O teste existe para que a próxima pessoa saiba que a queda
    // é decidida, e veja onde ela mora.
    mocksComDuasRaizes();
    render(
      <TaskModal
        open
        newTaskTeam={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(await screen.findByLabelText("Designar responsável"));
    expect(await screen.findByText("Selecionar todos (4)")).toBeTruthy();
    expect(api.listMembersDoTime).not.toHaveBeenCalled();
  });
});

// ⚠️ A OUTRA METADE DO QUE ELA REPORTOU: *"estão aparecendo projetos de outro
// time raiz né"*. O conserto tem duas pontas -- o backend passou a aceitar
// `?team_id=` (`GET /projects`, provado em
// `backend/tests/integration/test_projects_lente_http_db.py`) e o modal passou
// a mandá-lo. Sem este teste a ponta do front não tem ninguém: `tsc` garante
// que o campo EXISTE, não que o valor está certo.
describe("TaskModal -- o seletor de projeto recorta pelo time", () => {
  it("manda o time do quadro no `listProjects`", async () => {
    mocks();
    render(
      <TaskModal
        open
        newTaskTeam={{ teamId: RAIZ, internal: false }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByLabelText(/^Projeto/);
    await waitFor(() => {
      expect(api.listProjects).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: RAIZ }),
      );
    });
  });

  it("⚠️ e NÃO pergunta nada quando o seletor não aparece", async () => {
    // Quadro de subtime: a tarefa nasce interna, não há projeto a escolher.
    // Uma requisição aqui seria trabalho para montar uma lista que ninguém vê.
    mocks();
    render(
      <TaskModal
        open
        newTaskTeam={{ teamId: "team-sub", internal: true }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await screen.findByLabelText("Designar responsável");
    expect(api.listProjects).not.toHaveBeenCalled();
  });
});
