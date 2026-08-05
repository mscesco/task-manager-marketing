/**
 * O CORPO que sai no `POST /tasks/{id}/duplicate`.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE. Em 05/08 o passo 2 do modal montou
 * `subtask_assignees` e `skip_subtasks`, e os testes de componente afirmaram
 * que o modal os mandava — com `duplicateTask` **mockado**. O corpo real é
 * montado campo a campo dentro de `duplicateTask`, e os dois campos novos
 * simplesmente não estavam lá. Resultado na tela: a subtarefa nascia sem
 * responsável e a marcada como "não levar" ia junto assim mesmo, com tudo
 * verde nos portões.
 *
 * A lição é do formato do corpo, não da duplicação: **mock do cliente HTTP
 * esconde campo que o cliente não repassa.** Onde o corpo é montado campo a
 * campo, alguém tem de olhar o corpo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { duplicateTask } from "../api";

const RESPOSTA = {
  id: "t-copia",
  skipped_assignees: [],
  promoted_to_root: false,
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

describe("duplicateTask -- o corpo que realmente sai", () => {
  it("leva subtask_assignees e skip_subtasks", async () => {
    await duplicateTask("t-origem", {
      title: "Cópia de X",
      include_subtasks: true,
      subtask_assignees: { s1: ["u-ana"] },
      skip_subtasks: ["s2"],
    });
    const corpo = corpoEnviado();
    expect(corpo.subtask_assignees).toEqual({ s1: ["u-ana"] });
    expect(corpo.skip_subtasks).toEqual(["s2"]);
  });

  it("sem os campos, manda vazio -- e não `undefined`", () => {
    // `undefined` some do JSON e o backend cai no default; vazio é explícito
    // e mantém os dois lados falando a mesma língua.
    return duplicateTask("t-origem", { title: "Cópia de X" }).then(() => {
      const corpo = corpoEnviado();
      expect(corpo.subtask_assignees).toEqual({});
      expect(corpo.skip_subtasks).toEqual([]);
    });
  });

  it("continua mandando o que a Spec 033 já mandava", () => {
    return duplicateTask("t-origem", {
      title: "Cópia de X",
      assignee_ids: ["u-ana"],
      include_subtasks: true,
    }).then(() => {
      const corpo = corpoEnviado();
      expect(corpo.title).toBe("Cópia de X");
      expect(corpo.assignee_ids).toEqual(["u-ana"]);
      expect(corpo.include_subtasks).toBe(true);
      // ⚠️ D5: data nenhuma no corpo. A cópia nasce sem prazo.
      expect(corpo.due_date).toBeUndefined();
      expect(corpo.start_date).toBeUndefined();
    });
  });
});
