/**
 * O corpo que sai ao marcar que a solicitação virou tarefa.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marcarTarefaCriada } from "../api";

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

describe("marcarTarefaCriada: o corpo inteiro", () => {
  it("com a referência da tarefa", async () => {
    await marcarTarefaCriada("s-1", true, "TAR-42");
    expect(corpoEnviado()).toEqual({ created: true, task_ref: "TAR-42" });
  });

  it("sem referência, `task_ref` viaja como `null` e não some", async () => {
    await marcarTarefaCriada("s-1", false);
    expect(corpoEnviado()).toEqual({ created: false, task_ref: null });
  });
});
