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
    team_id: RAIZ,
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
    due_date: "2026-03-10",
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
   * ⚠️ D14: o aviso é a única proteção contra criar N subtarefas órfãs num
   * clique. Se ele sumir do modal, o teste de backend
   * `test_include_assignees_false_cria_subtarefa_sem_responsavel` passa a
   * defender um buraco.
   */
  it("D14 -- desmarcar responsáveis AVISA, e marcar cala", async () => {
    montar();
    abrir([filha("s1"), filha("s2")]);
    await waitFor(() => {
      expect(screen.getByText(/Levar as subtarefas/)).toBeTruthy();
    });
    const caixa = screen.getByLabelText(/Levar os responsáveis das subtarefas/);
    fireEvent.click(caixa);
    await waitFor(() => {
      expect(
        screen.getByText(/2 subtarefas copiadas nascerão sem responsável/)
      ).toBeTruthy();
    });
    fireEvent.click(caixa);
    await waitFor(() => {
      expect(screen.queryByText(/nascerão sem responsável/)).toBeNull();
    });
  });

  /**
   * O caso sutil: o pré-preenchimento tem que esperar `listMembersDoTime`.
   * Rodando antes, `Sumido` entraria marcado e o salvar devolveria 422.
   */
  it("D9 -- responsável sem alcance NÃO entra pré-marcado", async () => {
    // A origem tem ANA e SUMIDO; só ANA alcança o time da tarefa.
    montar([ANA]);
    abrir();
    await waitFor(() => {
      expect(screen.getByText("Duplicar tarefa")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));
    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(payload.assignee_ids).toEqual([ANA]);
  });

  it("chama duplicateTask (não createTask) com as duas caixas", async () => {
    montar();
    abrir([filha("s1")]);
    await waitFor(() => {
      expect(screen.getByText(/Levar as subtarefas/)).toBeTruthy();
    });
    fireEvent.click(
      screen.getByLabelText(/Levar os responsáveis das subtarefas/)
    );
    fireEvent.click(screen.getByRole("button", { name: /Duplicar$/ }));

    await waitFor(() => {
      expect(api.duplicateTask).toHaveBeenCalled();
    });
    // ⚠️ createTask criaria SÓ o pai, sem a subárvore e sem transação única.
    expect(api.createTask).not.toHaveBeenCalled();
    const [idOrigem, payload] = vi.mocked(api.duplicateTask).mock.calls[0];
    expect(idOrigem).toBe(ORIGEM.id);
    expect(payload.include_subtasks).toBe(true);
    expect(payload.include_assignees).toBe(false);
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
