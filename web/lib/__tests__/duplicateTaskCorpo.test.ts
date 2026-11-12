/**
 * O corpo que sai no `POST /tasks/{id}/duplicate`. `duplicateTask` monta o corpo
 * campo a campo, e mock do cliente HTTP esconde campo que o cliente não repassa:
 * campo novo no `TaskDuplicateInput` ganha lugar no `toEqual` daqui.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { duplicateTask } from "../api";

const RESPOSTA = { id: "t-copia", skipped_assignees: [], promoted_to_root: false };

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

describe("duplicateTask: o corpo que realmente sai", () => {
  it("com todos os campos, o corpo inteiro", async () => {
    await duplicateTask("t-origem", {
      title: "Cópia de X",
      description: "corpo",
      priority: "HIGH",
      project_id: "p-1",
      parent_task_id: "t-mae",
      team_id: "team-crm",
      assignee_ids: ["u-ana"],
      include_subtasks: true,
      include_assignees: false,
      subtask_assignees: { s1: ["u-ana"] },
      skip_subtasks: ["s2"],
    });
    expect(corpoEnviado()).toEqual({
      title: "Cópia de X",
      description: "corpo",
      priority: "HIGH",
      project_id: "p-1",
      parent_task_id: "t-mae",
      team_id: "team-crm",
      assignee_ids: ["u-ana"],
      include_subtasks: true,
      include_assignees: false,
      subtask_assignees: { s1: ["u-ana"] },
      skip_subtasks: ["s2"],
    });
  });

  it("só o título: os padrões vão explícitos, e nenhuma data", async () => {
    // `undefined` some do JSON e o backend cairia no default dele; a cópia
    // nasce sem prazo, então nenhuma data viaja.
    await duplicateTask("t-origem", { title: "Cópia de X" });
    expect(corpoEnviado()).toEqual({
      title: "Cópia de X",
      description: "",
      project_id: null,
      parent_task_id: null,
      team_id: null,
      assignee_ids: [],
      include_subtasks: false,
      include_assignees: true,
      subtask_assignees: {},
      skip_subtasks: [],
    });
  });
});
