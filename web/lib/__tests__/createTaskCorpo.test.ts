/**
 * O CORPO que sai no `POST /tasks`.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE E O SEGUNDO DO GENERO. Em
 * 05/08 o modal de duplicar montou `subtask_assignees` e `skip_subtasks`, os
 * testes de componente afirmaram que o modal os mandava -- com o cliente HTTP
 * **mockado** -- e o corpo real nao os tinha. Nasceu o
 * `duplicateTaskCorpo.test.ts`, com a licao escrita no topo.
 *
 * ⚠️ EM 12/08 A MESMA FALHA ACONTECEU NA FUNCAO VIZINHA. A fatia 5b-6 declarou
 * `board_id` no `TaskCreateInput` (com quinze linhas de comentario), o
 * `TaskModal` passou a preenche-lo, o `Board` a passa-lo, o backend inteiro a
 * consumi-lo -- e a linha que poe o campo no CORPO de `createTask` nunca foi
 * escrita. Toda tarefa criada dentro de um quadro avulso nasceu no Quadro
 * geral, por um mes, com os tres portoes verdes.
 *
 * ⚠️ E O SINTOMA NAO APONTAVA PARA CA: a tarefa nao dava erro, nao sumia e nao
 * ficava sem dono. Ela aparecia na LENTE do time, marcada como "Interna" --
 * porque `team_id` ia no corpo e `board_id` nao. Meio certo e mais dificil de
 * ler que tudo errado.
 *
 * A licao continua sendo do FORMATO DO CORPO, e nao da rota: **mock do cliente
 * HTTP esconde campo que o cliente nao repassa.** Campo novo no `POST /tasks`
 * ganha uma linha AQUI, no mesmo commit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createTask } from "../api";

const RESPOSTA = {
  id: "t-nova",
  title: "Tarefa nova",
  status: "BACKLOG",
  team_id: "team-crm",
  board_id: "board-campanhas",
  column_id: "col-backlog",
  depth: 0,
};

function corpoEnviado(): Record<string, unknown> {
  const chamada = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = chamada[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => RESPOSTA,
      text: async () => JSON.stringify(RESPOSTA),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * ⚠️ `team_id` VAI EM TODAS AS CHAMADAS DESTE ARQUIVO, de proposito. Sem ele,
 * `createTask` resolve a raiz por `getRootTeamId()` -- que e OUTRO `fetch`, e
 * ele viraria a chamada [0], fazendo `corpoEnviado()` ler a requisicao errada
 * e o teste falhar longe da causa.
 */
const BASE = {
  title: "Tarefa nova",
  team_id: "team-crm",
  assignee_ids: ["u-ana"],
};

describe("createTask -- o corpo que realmente sai", () => {
  it("⚠️ leva board_id quando a tarefa nasce num quadro avulso", async () => {
    await createTask({ ...BASE, board_id: "board-campanhas" });
    expect(corpoEnviado().board_id).toBe("board-campanhas");
  });

  it("⚠️ OMITE board_id no Quadro geral, e nao manda null", async () => {
    // ⚠️ AUSENTE E O CONTRATO, e nao um detalhe: `board_id` ausente faz o
    // backend cair em `default_board_and_column_for_status` -- o Quadro geral,
    // que e o comportamento de 100% das tarefas ate 12/08. Mandar `null`
    // explicito passaria pelo Pydantic do mesmo jeito, mas afirmaria uma
    // escolha onde nao houve nenhuma.
    await createTask({ ...BASE, board_id: null });
    expect("board_id" in corpoEnviado()).toBe(false);

    vi.mocked(globalThis.fetch).mockClear();
    await createTask(BASE);
    expect("board_id" in corpoEnviado()).toBe(false);
  });

  it("⚠️ leva start_date no corpo -- Spec 038, fatia A", async () => {
    // ⚠️ E EXATAMENTE A FALHA QUE O TOPO DESTE ARQUIVO DESCREVE, evitada uma
    // terceira vez. `start_date` existe no backend desde sempre (schema, router
    // e `TaskService`), o tipo `TaskCreateInput` passou a declara-lo, e o
    // `TaskModal` a preenche-lo. Sem a linha dentro do corpo de `createTask`,
    // a data digitada na criacao sumiria em silencio -- sem erro, sem 422, e
    // com os tres portoes verdes.
    await createTask({ ...BASE, start_date: "2026-08-01" });
    expect(corpoEnviado().start_date).toBe("2026-08-01");
  });

  it("⚠️ sem inicio manda null, e nao omite", async () => {
    // ⚠️ DIFERENTE DO `board_id` LOGO ACIMA, e a diferenca e de contrato.
    // Ausencia de `board_id` significa "escolha o padrao"; ausencia de
    // `start_date` nao significa nada -- `null` E o valor, e o `due_date` ao
    // lado ja se comporta assim. Omitir faria os dois campos de data seguirem
    // regras diferentes no mesmo corpo.
    await createTask(BASE);
    const corpo = corpoEnviado();
    expect("start_date" in corpo).toBe(true);
    expect(corpo.start_date).toBe(null);
  });

  it("⚠️ leva watcher_ids -- Spec 053, fatia D", async () => {
    // A falha do topo deste arquivo, evitada pela quarta vez: o backend aceita
    // `watcher_ids` e o descartaria em silencio se a linha nao estivesse no
    // corpo.
    await createTask({ ...BASE, watcher_ids: ["u-bia"] });
    expect(corpoEnviado().watcher_ids).toEqual(["u-bia"]);
  });

  it("sem seguidores, omite o campo (como `assignee_ids`)", async () => {
    await createTask({ ...BASE, watcher_ids: [] });
    expect("watcher_ids" in corpoEnviado()).toBe(false);
  });

  it("continua mandando o que ja mandava antes da fatia 5b-6", async () => {
    await createTask({
      ...BASE,
      description: "corpo",
      priority: "HIGH",
      due_date: "2026-09-01",
      project_id: "p-1",
      board_id: "board-campanhas",
    });
    const corpo = corpoEnviado();
    expect(corpo.title).toBe("Tarefa nova");
    expect(corpo.description).toBe("corpo");
    expect(corpo.priority).toBe("HIGH");
    expect(corpo.due_date).toBe("2026-09-01");
    expect(corpo.project_id).toBe("p-1");
    expect(corpo.team_id).toBe("team-crm");
    expect(corpo.assignee_ids).toEqual(["u-ana"]);
  });
});
