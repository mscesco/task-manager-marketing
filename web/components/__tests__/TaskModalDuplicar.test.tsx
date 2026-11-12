/**
 * TaskModal em modo DUPLICAR: a montagem (a regra pura está em
 * `lib/duplicacaoTarefa`). Chamar `duplicateTask` e não `createTask`, mandar
 * as caixas, esperar o alcance (`listMembersDoTime`) antes de pré-preencher e
 * esconder o prazo. Pré-preencher antes do alcance marcaria um responsável que
 * não alcança o time, e o salvar levaria 422.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import TaskModal from "@/components/TaskModal";
import type { Member, Task } from "@/lib/api";

// Espia o `useAvisar` em vez de montar o `AvisosProvider`.
const avisar = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toasts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/Toasts")>()),
  useAvisar: () => avisar,
}));

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
  };
});

const api = await import("@/lib/api");

// Teto maior que o padrão de 1000 ms: a tela só fica pronta depois de uma cadeia
// de promessas (`listMembers` -> alcance -> pré-preenchimento), que em máquina
// carregada passa de 1 s. Asserção errada continua falhando, só demora mais.
configure({ asyncUtilTimeout: 5000 });

const RAIZ = "team-raiz";
const ANA = "user-ana";
const SUMIDO = "user-sumido";

function membro(id: string, name: string, is_active = true): Member {
  return {
    id,
    workspace_id: "ws",
    name,
    email: `${id}@x.com`,
    is_active,
    team_ids: [RAIZ],
  };
}

function task(over: Partial<Task> & { id: string; title: string }): Task {
  return {
    project_id: "proj-1",
    parent_task_id: null,
    team_id: RAIZ,
    description: "briefing",
    status: "IN_PROGRESS",
    priority: "HIGH",
    position: 0,
    depth: 0,
    path: over.id,
    // Obrigatórios em `Task`; não troque por `as Task` (esconde campo faltando).
    board_id: "board-geral",
    column_id: "col-backlog",
    can_delete: true,
    start_date: null,
    due_date: "2026-03-10",
    due_time: null,
    completed_at: null,
    terminal_since: null,
    created_by: ANA,
    is_archived: false,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    assignee_ids: [ANA],
    ...over,
  };
}

// Dois responsáveis de propósito: com um só, o teste do alcance passa mesmo com
// o filtro desligado (não há o que filtrar).
const ORIGEM = task({
  id: "origem-1",
  title: "Campanha Black Friday",
  assignee_ids: [ANA, SUMIDO],
});

/** `alcancam` = quem o backend diz que alcanca o time da tarefa. */
function montar(alcancam: string[] = [ANA, SUMIDO]) {
  vi.mocked(api.listMembers).mockResolvedValue([
    membro(ANA, "Ana"),
    membro(SUMIDO, "Sumido"),
  ]);
  vi.mocked(api.listMembersDoTime).mockResolvedValue(
    alcancam.map((id) => membro(id, id === ANA ? "Ana" : "Sumido"))
  );
  vi.mocked(api.getRootTeamId).mockResolvedValue(RAIZ);
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  vi.mocked(api.duplicateTask).mockResolvedValue({
    ...task({ id: "copia-1", title: "Cópia de Campanha Black Friday" }),
    skipped_assignees: [],
    promoted_to_root: false,
  });
}

function abrir(filhos: Task[] = []) {
  return render(
    <TaskModal
      newTaskTeam={null}
      open
      duplicarDe={ORIGEM}
      filhosDaOrigem={filhos}
      onClose={() => {}}
      onSaved={() => {}}
    />
  );
}

const filha = (id: string, is_archived = false) =>
  task({ id, title: `sub ${id}`, parent_task_id: ORIGEM.id, is_archived });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Clica em "Duplicar" DEPOIS do pré-preenchimento: antes dele o botão está
 * travado ("Escreva o título") e o clique se perde.
 */
async function clicarDuplicar() {
  await waitFor(() => {
    expect((screen.getByLabelText(/^Título/) as HTMLInputElement).value).toContain("Cópia de");
  });
  fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
}

describe("TaskModal -- modo duplicar", () => {
  it('abre como "Duplicar tarefa" com o título prefixado', async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    const titulo = screen.getByLabelText(/Título/i) as HTMLInputElement;
    await waitFor(() => {
      expect(titulo.value).toBe("Cópia de Campanha Black Friday");
    });
  });

  /**
   * Esconder o campo é mais forte que abrir vazio: vazio convida a copiar a
   * data da origem, e a cópia nasceria vencida.
   */
  it("o campo de PRAZO não existe no modo cópia", async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    expect(screen.queryByLabelText(/Prazo/i)).toBeNull();
  });

  it('o rótulo conta só as subtarefas vivas e diz "diretas"', async () => {
    montar();
    abrir([filha("s1"), filha("s2"), filha("s3", true)]);
    await waitFor(() => {
      expect(screen.getByText("Levar as subtarefas (2 diretas)")).toBeTruthy();
    });
  });

  /**
   * Passo 2: nenhuma subtarefa sai sem responsável, e o passo NÃO aparece
   * quando não há o que decidir (a duplicação continua de um clique).
   */
  it("passo 2 NÃO aparece quando as subtarefas herdam responsável válido", async () => {
    montar();
    abrir([filha("s1"), filha("s2")]); // as duas com ANA, que alcança
    await waitFor(() => {
      expect(screen.getByText(/Levar as subtarefas/)).toBeTruthy();
    });
    expect(screen.queryByText(/precisam de responsável na cópia/)).toBeNull();
    // ⚠️ Espera o pré-preenchimento: antes dele o botão está travado por
    // "Escreva o título", e o teste mediria a corrida, não a regra.
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Duplicar$/ }) as HTMLButtonElement)
          .disabled
      ).toBe(false);
    });
  });

  it("subtarefa sem responsável válido -> passo 2 aparece e TRAVA o salvar", async () => {
    // SUMIDO não alcança: a filha fica sem ninguém que possa assumir.
    montar([ANA]);
    abrir([task({ id: "s1", title: "sub s1", parent_task_id: ORIGEM.id, assignee_ids: [SUMIDO] })]);
    await waitFor(() => {
      expect(screen.getByText(/precisam de responsável na cópia/)).toBeTruthy();
    });
    const botao = screen.getByRole("button", {
      name: /Duplicar$/,
    }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    // O motivo tem de estar no botão. `waitFor`: o título da subtarefa chega um
    // ciclo depois do passo 2, e até lá o botão está travado pelo motivo errado
    // ("Escreva o título") -- o `disabled` acima passa nos dois estados.
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Duplicar$/ }) as HTMLButtonElement)
          .title
      ).toContain("sub s1");
    });
  });

  it("escolher alguém destrava e o payload leva subtask_assignees", async () => {
    montar([ANA]);
    abrir([task({ id: "s1", title: "sub s1", parent_task_id: ORIGEM.id, assignee_ids: [SUMIDO] })]);
    await waitFor(() => {
      expect(screen.getByLabelText(/Responsável de sub s1/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Responsável de sub s1/), {
      target: { value: ANA },
    });
    await clicarDuplicar();
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(payload.subtask_assignees).toEqual({ s1: [ANA] });
    expect(payload.skip_subtasks).toEqual([]);
  });

  it('"não levar esta" também destrava, e vai em skip_subtasks', async () => {
    montar([ANA]);
    abrir([task({ id: "s1", title: "sub s1", parent_task_id: ORIGEM.id, assignee_ids: [SUMIDO] })]);
    await waitFor(() => {
      expect(screen.getByLabelText(/Não levar esta subtarefa/)).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/Não levar esta subtarefa/));
    await clicarDuplicar();
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(payload.skip_subtasks).toEqual(["s1"]);
    // ⚠️ Pulada NÃO pode ir também em subtask_assignees: o backend recusa o
    // lote por incoerência e a pessoa não saberia por quê.
    expect(payload.subtask_assignees).toEqual({});
  });

  it("a escolha do passo 2 SOBREVIVE ao re-render do pai", async () => {
    // `filhosDaOrigem` é montado inline no Board (referência nova a cada render
    // do pai). Prop estável no teste esconderia o defeito: o rerender passa array NOVO.
    montar([ANA]);
    const pendente = () =>
      task({ id: "s1", title: "sub s1", parent_task_id: ORIGEM.id, assignee_ids: [SUMIDO] });
    const { rerender } = render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[pendente()]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/Responsável de sub s1/)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Responsável de sub s1/), {
      target: { value: ANA },
    });

    rerender(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[pendente()]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await act(async () => {});
    expect(
      (screen.getByLabelText(/Responsável de sub s1/) as HTMLSelectElement)
        .value
    ).toBe(ANA);
  });

  /**
   * O caso sutil: o pré-preenchimento tem que esperar `listMembersDoTime`.
   * Rodando antes, `Sumido` entraria marcado e o salvar devolveria 422.
   */
  it("responsável sem alcance NÃO entra pré-marcado", async () => {
    // A origem tem ANA e SUMIDO; só ANA alcança o time da tarefa.
    montar([ANA]);
    abrir();
    await clicarDuplicar();
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(payload.assignee_ids).toEqual([ANA]);
  });

  it("chama duplicateTask (não createTask), sem include_assignees", async () => {
    montar();
    abrir([filha("s1")]); // herda ANA, que alcança -> nada pendente
    await waitFor(() => {
      expect(screen.getByText(/Levar as subtarefas/)).toBeTruthy();
    });
    await clicarDuplicar();

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    // ⚠️ createTask criaria SÓ o pai, sem a subárvore e sem transação única.
    expect(api.createTask).not.toHaveBeenCalled();
    const [idOrigem, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(idOrigem).toBe(ORIGEM.id);
    expect(payload.include_subtasks).toBe(true);
    // Não existe "leve sem responsáveis": se voltar ao payload, a subtarefa órfã volta.
    expect(payload.include_assignees).toBeUndefined();
    // Nada pendente -> nada a decidir -> as duas chaves saem vazias.
    expect(payload.subtask_assignees).toEqual({});
    expect(payload.skip_subtasks).toEqual([]);
    // Cópia de subtarefa nasce irmã -- o pai da origem é repassado.
    expect(payload.parent_task_id).toBe(ORIGEM.parent_task_id);
    // O projeto vem da origem, não do seletor (que nem aparece).
    expect(payload.project_id).toBe(ORIGEM.project_id);
  });

  it("não manda data nenhuma no payload", async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    await clicarDuplicar();
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect("due_date" in payload).toBe(false);
    expect("start_date" in payload).toBe(false);
    expect("status" in payload).toBe(false);
  });
});

describe("TaskModal -- avisos pós-cópia", () => {
  /**
   * Cópia de subtarefa sob pai arquivado é promovida a topo pelo backend (o
   * quadro só desenha raiz); a tela tem de contar, senão a hierarquia muda
   * pelas costas de quem clicou.
   */
  it("avisa quando a cópia foi promovida a topo", async () => {
    montar();
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...task({ id: "copia-2", title: "Cópia" }),
      skipped_assignees: [],
      promoted_to_root: true,
    });
    const alerta = avisar;
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    await clicarDuplicar();
    await waitFor(() => {
      expect(alerta).toHaveBeenCalled();
    });
    expect(alerta.mock.calls[0][0]).toContain("tarefa de topo");
  });

  it("cala quando não há nada a avisar", async () => {
    montar();
    const alerta = avisar;
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    await clicarDuplicar();
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    expect(alerta).not.toHaveBeenCalled();
  });

  it("UM alerta só quando os dois avisos acontecem juntos", async () => {
    // Dois alertas seguidos fazem qualquer um clicar OK no segundo sem ler.
    montar();
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...task({ id: "copia-3", title: "Cópia" }),
      skipped_assignees: [SUMIDO],
      promoted_to_root: true,
    });
    const alerta = avisar;
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    await clicarDuplicar();
    await waitFor(() => {
      expect(alerta).toHaveBeenCalledTimes(1);
    });
    const texto = alerta.mock.calls[0][0] as string;
    expect(texto).toContain("tarefa de topo");
    expect(texto).toContain("Sumido");
  });
});

describe("TaskModal -- as edições da pessoa SOBREVIVEM", () => {
  /**
   * As dependências do pré-preenchimento mudam depois de o modal abrir (alcance
   * e membros chegam da rede; `filhosDaOrigem` é array novo a cada render do
   * pai). `rerender` com array novo reproduz o chamador real.
   */
  it("editar o título e o pai re-renderizar NÃO desfaz a edição", async () => {
    montar();
    const { rerender } = render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Título/i) as HTMLInputElement).value
      ).toBe("Cópia de Campanha Black Friday");
    });

    fireEvent.change(screen.getByLabelText(/Título/i), {
      target: { value: "Campanha de setembro" },
    });

    // ARRAY NOVO, como o Board manda a cada render.
    rerender(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await act(async () => {});

    expect((screen.getByLabelText(/Título/i) as HTMLInputElement).value).toBe(
      "Campanha de setembro"
    );
  });

  it("responsável removido não reaparece após re-render do pai", async () => {
    montar();
    const { rerender } = render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    // Origem tem ANA e SUMIDO; os dois alcançam neste cenário.
    await waitFor(() => {
      expect(screen.getAllByTitle(/Remover/i).length).toBe(2);
    });

    const chips = screen.getAllByTitle(/Remover/i);
    fireEvent.click(chips[chips.length - 1]);
    await waitFor(() => {
      expect(screen.getAllByTitle(/Remover/i).length).toBe(1);
    });

    rerender(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await act(async () => {});
    expect(screen.getAllByTitle(/Remover/i).length).toBe(1);
  });

  it("as caixas marcadas pela pessoa sobrevivem ao re-render", async () => {
    montar();
    const filhas = [filha("s1"), filha("s2")];
    const { rerender } = render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={filhas}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/Levar as subtarefas/)).toBeTruthy();
    });
    const caixa = screen.getByLabelText(
      /Levar as subtarefas/
    ) as HTMLInputElement;
    fireEvent.click(caixa);
    expect(caixa.checked).toBe(false);

    // Array NOVO com o mesmo conteúdo -- o que o Board faz.
    rerender(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[filha("s1"), filha("s2")]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await act(async () => {});
    expect(
      (
        screen.getByLabelText(/Levar as subtarefas/) as HTMLInputElement
      ).checked
    ).toBe(false);
    // Não existe mais o estado "N subtarefas nascerão sem responsável".
    expect(screen.queryByText(/nascerão sem responsável/)).toBeNull();
  });
});

describe("TaskModal -- guardas do pré-preenchimento", () => {
  /**
   * A guarda de `ref` é keyed pelo ID da origem, não pela identidade do
   * objeto. Isto cobre o caso em que o chamador entrega um objeto NOVO com o
   * mesmo id -- acontece sempre que a tela refaz a busca de tarefas enquanto
   * o modal está aberto. Sem a guarda, o pré-preenchimento roda de novo e
   * apaga o que a pessoa escreveu.
   */
  it("objeto novo com o MESMO id não re-preenche", async () => {
    montar();
    const { rerender } = render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Título/i) as HTMLInputElement).value
      ).toBe("Cópia de Campanha Black Friday");
    });
    fireEvent.change(screen.getByLabelText(/Título/i), {
      target: { value: "Meu título" },
    });

    // Mesmo id, objeto novo -- o que uma re-busca de tarefas produz.
    rerender(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={{ ...ORIGEM }}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await act(async () => {});
    expect((screen.getByLabelText(/Título/i) as HTMLInputElement).value).toBe(
      "Meu título"
    );
  });

  /**
   * `listMembersDoTime` FALHANDO tem de resolver mesmo assim, senão o modal
   * abre em branco para sempre.
   */
  it("alcance que FALHA ainda pré-preenche", async () => {
    montar();
    // Rejeição ADIADA: já rejeitada, o `.then` do sucesso nunca seria alcançado
    // e trocar o `.finally` por `.then` passaria. A promessa nasce na chamada,
    // senão rejeita sem dono antes de o modal pedir ("Unhandled Rejection").
    vi.mocked(api.listMembersDoTime).mockImplementation(
      () => new Promise((_res, rej) => setTimeout(() => rej(new Error("500")), 10))
    );
    render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Título/i) as HTMLInputElement).value
      ).toBe("Cópia de Campanha Black Friday");
    });
    // Sem alcance ninguém é escondido -- o 422 do backend segue de pé.
    expect(screen.getAllByTitle(/Remover/i).length).toBe(2);
  });
});

describe("TaskModal -- a espera pelo alcance é real", () => {
  /**
   * Mock que resolve na hora não distingue "esperou o alcance" de "preencheu
   * antes e deu sorte"; só uma promessa controlada separa os dois.
   */
  it("não pré-preenche enquanto o alcance não responde", async () => {
    montar();
    let liberar!: (v: Member[]) => void;
    vi.mocked(api.listMembersDoTime).mockReturnValue(
      new Promise((res) => {
        liberar = res;
      })
    );

    render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    // Título AINDA vazio: preencher aqui marcaria o SUMIDO, que não alcança.
    expect((screen.getByLabelText(/Título/i) as HTMLInputElement).value).toBe(
      ""
    );

    // Só ANA alcança.
    liberar([membro(ANA, "Ana")]);
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Título/i) as HTMLInputElement).value
      ).toBe("Cópia de Campanha Black Friday");
    });
    // E o SUMIDO ficou de fora, por espera e não por sorte.
    expect(screen.getAllByTitle(/Remover/i).length).toBe(1);
  });
});

describe("TaskModal -- responsável DESATIVADO depois", () => {
  /**
   * Responsável da origem que foi desativado: `listMembers` só devolve ativos,
   * então ele não pode sobreviver pré-marcado (o salvar daria 422).
   */
  it("não é pré-marcado e o salvar completa", async () => {
    montar();
    // SUMIDO foi desativado: some da lista de membros E do alcance.
    vi.mocked(api.listMembers).mockResolvedValue([membro(ANA, "Ana")]);
    vi.mocked(api.listMembersDoTime).mockResolvedValue([membro(ANA, "Ana")]);

    render(
      <TaskModal
        newTaskTeam={null}
        open
        duplicarDe={ORIGEM}
        filhosDaOrigem={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Título/i) as HTMLInputElement).value
      ).toBe("Cópia de Campanha Black Friday");
    });

    // Só a Ana ficou.
    expect(screen.getAllByTitle(/Remover/i).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /^Duplicar$/ }));
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    // O desativado NÃO vai no payload -- é o que evitava o 422.
    expect(payload.assignee_ids).toEqual([ANA]);
  });
});

// O `board_id` é opcional no backend: perdê-lo não dá erro, a tarefa só nasce no
// Quadro geral. O lado "com quadro avulso" é provado em `Board.test.tsx`, pela tela.
describe("TaskModal -- board_id na criacao", () => {
  async function criarCom(defaultBoardId: string | null) {
    montar();
    vi.mocked(api.createTask).mockResolvedValue(task({ id: "nova", title: "X" }));
    render(
      <TaskModal
        newTaskTeam={null}
        open
        defaultBoardId={defaultBoardId}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.change(await screen.findByLabelText("Título"), {
      target: { value: "Tarefa nova" },
    });
    // Responsável é obrigatório: sem ele o botão trava e o teste mediria a trava.
    // A escolha mora num popover: sem abrir, a caixa nem existe no DOM.
    fireEvent.click(await screen.findByLabelText("Designar responsável"));
    const caixas = await screen.findAllByRole("checkbox");
    fireEvent.click(caixas[0]);
    fireEvent.click(screen.getByText("Criar tarefa"));
    await waitFor(() => expect(vi.mocked(api.createTask)).toHaveBeenCalled());
    return vi.mocked(api.createTask).mock.calls[0][0];
  }

  it("sem quadro avulso, vai null -- e o backend usa o Quadro geral", async () => {
    expect((await criarCom(null)).board_id).toBeNull();
  });
});
