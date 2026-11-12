/**
 * O corpo que sai ao criar subtarefa. Os extras chegam em camelCase e saem em
 * snake_case: o `toEqual` do corpo inteiro cai se um deles se perder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSubtask } from "../api";

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
      json: async () => ({}),
      text: async () => "{}",
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createSubtask: o corpo que realmente sai", () => {
  it("com projeto, responsáveis e prazo, o corpo inteiro", async () => {
    await createSubtask("t-mae", "Revisar texto", "p-1", {
      assigneeIds: ["u-ana", "u-bia"],
      dueDate: "2026-09-01",
    });
    expect(corpoEnviado()).toEqual({
      title: "Revisar texto",
      parent_task_id: "t-mae",
      project_id: "p-1",
      assignee_ids: ["u-ana", "u-bia"],
      due_date: "2026-09-01",
    });
  });

  it("sem projeto, lista vazia e prazo null: os três ficam fora do corpo", async () => {
    await createSubtask("t-mae", "Revisar texto", null, {
      assigneeIds: [],
      dueDate: null,
    });
    expect(corpoEnviado()).toEqual({
      title: "Revisar texto",
      parent_task_id: "t-mae",
    });
  });
});
