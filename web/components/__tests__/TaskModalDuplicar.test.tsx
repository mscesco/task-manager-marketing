/**
 * TaskModal em modo DUPLICAR (Spec 033, Fatia 5).
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE. A regra pura esta coberta por 18 testes em
 * `lib/duplicacaoTarefa`. O que NAO estava coberto e a MONTAGEM: o modal
 * chamar `duplicateTask` (e nao `createTask`), mandar as duas caixas, esperar
 * o conjunto de excluidos ficar pronto antes de pre-preencher, e esconder o
 * campo de prazo. Sabotar qualquer uma dessas deixa os tres portoes verdes.
 *
 * O caso mais sutil coberto aqui e o do pre-preenchimento: ele depende de
 * `listMembersDoTime` ter respondido. Se rodar antes, o conjunto de excluidos
 * esta VAZIO e um responsavel sem alcance entra marcado -- a pessoa leva 422
 * no salvar, nomeando alguem que ela talvez nem conheca.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
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
  };
});

const api = await import("@/lib/api");

// ⚠️ ESPERA MAIOR NESTE ARQUIVO, E O MOTIVO E MEDIDO -- NAO E "flakiness".
//
// O padrao do `@testing-library` e 1000ms por `waitFor`. Este arquivo e o
// UNICO que depende de uma CADEIA de promessas antes de a tela ficar no
// estado que os testes medem: `listMembers` -> `listMembersDoTime` (alcance)
// -> pre-preenchimento do titulo e dos responsaveis. Sao tres ciclos de
// render encadeados, e so entao o botao Duplicar destrava.
//
// Em 10/08/2026 o arquivo falhou DUAS VEZES em maquina carregada (rodando
// `tsc && npm test && next build` em sequencia), em testes DIFERENTES a cada
// vez, sempre com a tela parada no estado ANTERIOR ao pre-preenchimento --
// `title=""` e o botao travado por "Escreva o titulo da subtarefa.". A
// segunda falha estourou 1660ms, ou seja, passou do teto de 1000ms; na
// maquina do assistente o arquivo inteiro roda em ~2s e nunca falhou em 10
// execucoes.
//
// ⚠️ NAO E UM DEFEITO DO PRODUTO. A cadeia esta certa; o teto e que foi
// calibrado para uma maquina ociosa. Cinco segundos nao deixa teste quebrado
// passar -- assercao errada continua falhando, so demora mais para desistir.
//
// ⚠️ O LUGAR CERTO DISTO E UM `setupFiles` do vitest, valendo para todos os
// arquivos. Nao foi feito aqui porque `vitest.config.ts` e PORTAO, e mexer em
// portao no fim de uma fatia e como o projeto ja se machucou antes. Fatia
// propria.
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
    // ⚠️ Spec 036, fatia 3: `board_id`/`column_id` viraram obrigatorios em
    // `Task`. Um valor qualquer serve aqui -- este arquivo nao testa quadro --,
    // mas eles TEM de existir, senao o `tsc` recusa a fixture. Nao troque por
    // `as Task`: foi exatamente um `as` que escondeu este buraco por horas em
    // 10/08, no `minhasTarefas.test.tsx`.
    board_id: "board-geral",
    column_id: "col-backlog",
    start_date: null,
    due_date: "2026-03-10",
    due_time: null,
    completed_at: null,
    created_by: ANA,
    is_archived: false,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    assignee_ids: [ANA],
    ...over,
  };
}

// ⚠️ DOIS responsáveis, e é essencial: com um só, o teste da D9 passa
// mesmo com o filtro de alcance desligado -- não há o que filtrar. Foi
// exatamente o que aconteceu na primeira versão deste arquivo, e só a
// sabotagem revelou.
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
   * D5 na tela. Esconder o campo é mais forte que abrir vazio: vazio convida
   * a preencher com a data da origem, e cópia com data velha nasce vencida --
   * o job dispara TASK_OVERDUE em lote na primeira execução.
   */
  it("D5 -- o campo de PRAZO não existe no modo cópia", async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    expect(screen.queryByLabelText(/Prazo/i)).toBeNull();
  });

  it("D7 -- a caixa some quando não há subtarefa viva", async () => {
    montar();
    abrir([filha("s1", true)]); // só arquivada
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    expect(screen.queryByText(/Levar as subtarefas/)).toBeNull();
  });

  it('D4 -- o rótulo conta só as vivas e diz "diretas"', async () => {
    montar();
    abrir([filha("s1"), filha("s2"), filha("s3", true)]);
    await waitFor(() => {
      expect(screen.getByText("Levar as subtarefas (2 diretas)")).toBeTruthy();
    });
  });

  /**
   * PASSO 2 (ADR 0031). Substituiu a caixa "Levar os responsáveis" (D13) e o
   * aviso da D14 -- desmarcar aquela caixa significava "crie N subtarefas sem
   * ninguém", que é o estado que a ADR proíbe.
   *
   * ⚠️ O que estes testes defendem é a REGRA, não a tela: nenhuma subtarefa
   * sai daqui sem responsável, e o passo 2 NÃO aparece quando não há o que
   * decidir (senão a duplicação de um clique da Spec 033 morre).
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
    // ⚠️ O motivo TEM de estar no botão: botão travado sem explicação é a
    // pessoa procurando o que fez de errado.
    //
    // ⚠️ `waitFor`, E NÃO LEITURA DIRETA — este teste FALHOU INTERMITENTEMENTE
    // em 10/08/2026, em máquina rápida, com
    // `expected 'Escreva o título da subtarefa.' to contain 'sub s1'`.
    //
    // A corrida: o `waitFor` acima espera o TEXTO do passo 2, que aparece
    // assim que o alcance responde. O TÍTULO da subtarefa é pré-preenchido em
    // outro ciclo. Entre um e outro o botão já está travado — mas pelo motivo
    // ERRADO ("Escreva o título"), e a asserção de `disabled` acima passa
    // igual nos dois estados, então ela não protege nada aqui.
    //
    // ⚠️ O teste vizinho ("passo 2 NÃO aparece...") já tinha o aviso escrito e
    // já esperava. Este ficou de fora — mesma armadilha, um teste de distância.
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
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
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
    // ⚠️ ESTE É O TESTE QUE IMPORTA. `filhosDaOrigem` é montado inline no
    // Board (referência NOVA a cada render do pai), e foi exatamente isso que
    // apagou o que a pessoa digitava em 04/08. Prop com referência estável no
    // teste esconde o defeito -- por isso o rerender passa array NOVO.
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
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (screen.getByLabelText(/Responsável de sub s1/) as HTMLSelectElement)
        .value
    ).toBe(ANA);
  });

  /**
   * O caso sutil: o pré-preenchimento tem que esperar `listMembersDoTime`.
   * Rodando antes, `Sumido` entraria marcado e o salvar devolveria 422.
   */
  it("D9 -- responsável sem alcance NÃO entra pré-marcado", async () => {
    // A origem tem ANA e SUMIDO; só ANA alcança o time da tarefa.
    montar([ANA]);
    abrir();
    // ⚠️ ESPERA O PRE-PREENCHIMENTO, nao so o titulo do modal. Clicar assim
    // que o cabecalho aparece e uma corrida: o botao ainda esta travado por
    // "Escreva o titulo" e o clique nao faz nada. Este teste passava por
    // TIMING ate 05/08, quando um render a mais deslocou a corrida e ele caiu
    // sem que o produto tivesse mudado.
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^Título/) as HTMLInputElement).value
      ).toContain("Cópia de");
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    // ⚠️ createTask criaria SÓ o pai, sem a subárvore e sem transação única.
    expect(api.createTask).not.toHaveBeenCalled();
    const [idOrigem, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(idOrigem).toBe(ORIGEM.id);
    expect(payload.include_subtasks).toBe(true);
    // ⚠️ `include_assignees` MORREU com a ADR 0031: não existe mais "leve sem
    // responsáveis". Se voltar ao payload, a porta da subtarefa órfã reabre.
    expect(payload.include_assignees).toBeUndefined();
    // Nada pendente -> nada a decidir -> as duas chaves saem vazias.
    expect(payload.subtask_assignees).toEqual({});
    expect(payload.skip_subtasks).toEqual([]);
    // D3: cópia de subtarefa nasce irmã -- o pai da origem é repassado.
    expect(payload.parent_task_id).toBe(ORIGEM.parent_task_id);
    // O projeto vem da origem, não do seletor (que nem aparece).
    expect(payload.project_id).toBe(ORIGEM.project_id);
  });

  it("não manda data nenhuma no payload (D5)", async () => {
    montar();
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
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
   * Promoção por pai arquivado. Encontrado NA TELA em 03/08: a cópia de uma
   * subtarefa arquivada nascia irmã sob um pai arquivado, e o quadro só
   * desenha raiz -- a tarefa existia e nenhuma tela a mostrava. O backend
   * promove; a tela tem que CONTAR, senão a hierarquia muda pelas costas de
   * quem clicou.
   */
  it("avisa quando a cópia foi promovida a topo", async () => {
    montar();
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...task({ id: "copia-2", title: "Cópia" }),
      skipped_assignees: [],
      promoted_to_root: true,
    });
    const alerta = vi.spyOn(window, "alert").mockImplementation(() => {});
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
    await waitFor(() => {
      expect(alerta).toHaveBeenCalled();
    });
    expect(alerta.mock.calls[0][0]).toContain("tarefa de topo");
    alerta.mockRestore();
  });

  it("cala quando não há nada a avisar", async () => {
    montar();
    const alerta = vi.spyOn(window, "alert").mockImplementation(() => {});
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    expect(alerta).not.toHaveBeenCalled();
    alerta.mockRestore();
  });

  it("UM alerta só quando os dois avisos acontecem juntos", async () => {
    // Dois alertas seguidos fazem qualquer um clicar OK no segundo sem ler.
    montar();
    vi.mocked(api.duplicateTask).mockResolvedValue({
      ...task({ id: "copia-3", title: "Cópia" }),
      skipped_assignees: [SUMIDO],
      promoted_to_root: true,
    });
    const alerta = vi.spyOn(window, "alert").mockImplementation(() => {});
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
    await waitFor(() => {
      expect(alerta).toHaveBeenCalledTimes(1);
    });
    const texto = alerta.mock.calls[0][0] as string;
    expect(texto).toContain("tarefa de topo");
    expect(texto).toContain("Sumido");
    alerta.mockRestore();
  });
});

describe("TaskModal -- as edições da pessoa SOBREVIVEM", () => {
  /**
   * ⚠️ ESTE BLOCO EXISTE POR UM DEFEITO DE PRODUÇÃO (04/08).
   *
   * O efeito de pré-preenchimento rodava a cada mudança de dependência, e as
   * dependências mudam DEPOIS do modal abrir: `alcancamTime` e `membros`
   * chegam da rede, e `filhosDaOrigem` é montado inline no chamador
   * (Board.tsx:1009) -- referência nova a cada render do pai. Resultado: o
   * título voltava para "Cópia de X" depois de reescrito e responsável
   * removido reaparecia.
   *
   * ⚠️ Os testes acima NÃO pegavam, e o motivo importa: eles passam props com
   * referência ESTÁVEL, então o efeito roda uma vez e o defeito não existe
   * ali. `rerender` com array novo é o que reproduz o chamador real.
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
    await new Promise((r) => setTimeout(r, 30));

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
    await new Promise((r) => setTimeout(r, 30));
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
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (
        screen.getByLabelText(/Levar as subtarefas/) as HTMLInputElement
      ).checked
    ).toBe(false);
    // ⚠️ O aviso da D14 saiu junto com a caixa (ADR 0031): não existe mais o
    // estado "N subtarefas nascerão sem responsável" para avisar.
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
    await new Promise((r) => setTimeout(r, 30));
    expect((screen.getByLabelText(/Título/i) as HTMLInputElement).value).toBe(
      "Meu título"
    );
  });

  /**
   * ⚠️ `listMembersDoTime` FALHANDO tem de resolver mesmo assim. Se a espera
   * dependesse só do sucesso, o modal abriria em branco para sempre -- pior
   * que o defeito original, porque nem dá pra digitar por cima.
   */
  it("alcance que FALHA ainda pré-preenche", async () => {
    montar();
    // ⚠️ Rejeicao ADIADA. Com `mockRejectedValue` a promessa ja nasce
    // rejeitada e o `.then` do sucesso nunca seria alcancado de qualquer
    // jeito -- o teste passava mesmo com o `.finally` trocado por `.then`.
    // Adiar e o que separa "resolveu na falha" de "resolveu por acaso".
    vi.mocked(api.listMembersDoTime).mockReturnValue(
      new Promise((_res, rej) => setTimeout(() => rej(new Error("500")), 10))
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
   * ⚠️ Os testes acima usam mocks que resolvem NA HORA, e por isso não
   * distinguem "esperou o alcance" de "preencheu antes e deu sorte com o
   * timing". Medido em 04/08: com mock instantâneo, remover a espera não
   * derruba teste nenhum. Só uma promessa CONTROLADA separa os dois.
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
    // E o SUMIDO ficou de fora (D9), agora por espera e não por sorte.
    expect(screen.getAllByTitle(/Remover/i).length).toBe(1);
  });
});

describe("TaskModal -- responsável DESATIVADO depois (o 422 de 04/08)", () => {
  /**
   * ⚠️ Caso REAL: duplicar uma tarefa antiga cujo responsável saiu da empresa.
   * `listMembers` já devolve só ativos, então o desativado nunca aparece na
   * lista -- e a regra antiga ("remova os excluídos") não tinha como excluir
   * quem ela não conhece. Ele sobrevivia pré-marcado e o salvar dava 422.
   *
   * Este é o teste 13 do roteiro, que falhou na tela.
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

// =====================================================================
// FATIA 5b-6 -- `board_id` no payload de CRIACAO.
//
// ⚠️ ESTE BLOCO NASCEU DE UMA SABOTAGEM VERDE. Tirar `board_id: defaultBoardId`
// do `createTask` deixava os 32 testes do `Board.test.tsx` passando: eles
// conferem o que a tela DESENHA -- as colunas certas, o filtro por quadro, o
// nome no cabecalho do modal -- e nenhum conferia o que ela MANDA.
//
// ⚠️ E O CAMPO E OPCIONAL NO BACKEND, entao perde-lo NAO da erro: a tarefa
// nasce no Quadro geral, e quem a criou dentro do quadro avulso simplesmente
// nao a encontra. Enquanto mover tarefa entre quadros nao existir (fatia 5c),
// consertar isso significa APAGAR e recriar -- perdendo comentarios,
// historico, subtarefas e designacoes.
//
// ⚠️ MESMA ARMADILHA QUE O `tasks_router.py` JA TEVE COM `assignee_ids`
// (Spec 021). O backend ganhou `test_o_board_id_do_PAYLOAD_chega_no_comando`
// pelo mesmo motivo, na mesma semana.
//
// MORA AQUI, e nao no `Board.test.tsx`, porque o botao de salvar exige titulo
// E responsavel (ADR 0031) -- e a lista de membros ja esta montada neste
// arquivo.
//
// SABOTAGENS (medidas):
//   Y. Tirar `board_id: defaultBoardId` do `createTask` em `TaskModal.tsx`.
//   Z. Tirar `defaultBoardId={boardId ?? null}` do `<TaskModal>` no `Board`
//      -- ⚠️ NAO cai aqui, e nao tem como cair: este arquivo monta o modal
//      direto. Guardiao dela e a lacuna que sobra, e esta registrada no
//      `Board.test.tsx`.
// =====================================================================
describe("TaskModal -- board_id na criacao (fatia 5b-6)", () => {
  const AVULSO = "board-campanhas";

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
    // ⚠️ Responsavel e OBRIGATORIO na criacao (ADR 0031) -- sem ele o botao
    // fica travado e o teste mediria a trava, e nao o payload. E a escolha
    // mora dentro de um popover: sem abrir, a caixa nem existe no DOM.
    fireEvent.click(await screen.findByLabelText("Designar responsável"));
    const caixas = await screen.findAllByRole("checkbox");
    fireEvent.click(caixas[0]);
    fireEvent.click(screen.getByText("Criar tarefa"));
    await waitFor(() => expect(vi.mocked(api.createTask)).toHaveBeenCalled());
    return vi.mocked(api.createTask).mock.calls[0][0];
  }

  it("⚠️ com quadro avulso, o board_id VAI no payload", async () => {
    expect((await criarCom(AVULSO)).board_id).toBe(AVULSO);
  });

  it("sem quadro avulso, vai null -- e o backend usa o Quadro geral", async () => {
    // ⚠️ `null` E O COMPORTAMENTO DE SEMPRE, e o de 100% das tarefas ate
    // 12/08. Um default trocado aqui mandaria as 176 vivas para outro lugar.
    expect((await criarCom(null)).board_id).toBeNull();
  });
});
