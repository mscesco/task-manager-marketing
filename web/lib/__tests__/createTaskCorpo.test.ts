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
