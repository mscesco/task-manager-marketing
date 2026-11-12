// "Selecionar todos" e "Limpar" no seletor de responsáveis: só na criação, onde
// a seleção é local até o "Criar" (no detalhe cada caixa é uma requisição).

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
  // Literal completo, sem `as`: com `as` o `tsc` não acusa campo inexistente.
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
  // `newTaskTeam={null}` antes do spread: caminho sem time da tela; os testes
  // do caminho com time sobrescrevem pelo `props`.
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
    // O número no rótulo mostra que o botão age sobre os visíveis.
    expect(await screen.findByText("Selecionar todos (3)")).toBeTruthy();
    // "Limpar" ainda não: ninguém escolhido.
    expect(screen.queryByText("Limpar")).toBeNull();
  });

  it("selecionar todos marca os três e o botão some", async () => {
    await abrirSeletor();
    fireEvent.click(await screen.findByText("Selecionar todos (3)"));

    // A seleção se lê pelas pílulas "Remover X", não por um resumo.
    await waitFor(() => {
      expect(screen.getAllByLabelText(/^Remover /).length).toBe(3);
    });
    // Some quando clicar de novo não faria nada.
    expect(screen.queryByText(/Selecionar todos/)).toBeNull();
    expect(screen.getByText("Limpar")).toBeTruthy();
  });

  it("⚠️ com busca, “todos” age só nos VISÍVEIS -- e SOMA, não substitui", async () => {
    // Um `setAssigneeIds(visiveis)` ingênuo apagaria a Carla aqui.
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
    // jsdom não tem layout: só dá para prender o `fixed` (o card do modal tem
    // overflow e recortaria um painel `absolute`).
    const busca = await abrirSeletor();
    const painel = busca.parentElement!;
    expect(painel.style.position).toBe("fixed");
  });

  it("⚠️ DUPLICAR não tem os botões -- a lista dali é entrada do passo 2", async () => {
    // Na cópia os responsáveis vêm revisados da origem; "selecionar todos" mexeria nisso.
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

// No quadro geral de um time raiz, o seletor de responsável recorta pelo time
// que a tela passa; o mock de `getRootTeamId` que REJEITA (duas raízes) é o
// que exercita a queda.
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
    // Quem alcança a raiz: só o time dela.
    vi.mocked(api.listMembersDoTime).mockResolvedValue(TIME);
    // Duas raízes: `getRootTeamId` levanta.
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

    // Três, e não quatro.
    expect(await screen.findByText("Selecionar todos (3)")).toBeTruthy();
    expect(screen.queryByText("Dedé")).toBeNull();
    expect(api.listMembersDoTime).toHaveBeenCalledWith(RAIZ);
  });

  it("com a raiz na prop, nem PERGUNTA a raiz", async () => {
    // Sem pergunta, sem `console.error` (o Next desenha por cima da tela em dev).
    mocksComDuasRaizes();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <TaskModal
          open
          newTaskTeam={{ teamId: RAIZ, internal: false }}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
      await screen.findByLabelText("Designar responsável");
      await waitFor(() => expect(api.listMembersDoTime).toHaveBeenCalledWith(RAIZ));
      expect(api.getRootTeamId).not.toHaveBeenCalled();
      expect(erro).not.toHaveBeenCalled();
    } finally {
      erro.mockRestore();
    }
  });

  it("⚠️ com a raiz na prop, o SELETOR DE PROJETO CONTINUA NA TELA", async () => {
    // `teamId` responde o escopo e `internal` o seletor de projeto; separados,
    // responder a raiz não apaga o seletor.
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
    // `/quadro` sem time na URL: ninguém sabe a raiz, e a queda oferece demais
    // em vez de esconder gente.
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

// O seletor de projeto manda `?team_id=` do time.
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
    // Quadro de subtime: a tarefa nasce interna, sem lista de projetos para buscar.
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
