/**
 * O corpo que sai ao criar e editar comentário.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createComment, editComment } from "../api";

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

describe("comentário: o corpo inteiro", () => {
  it("comentário de primeiro nível manda só o conteúdo", async () => {
    await createComment("t-1", "Olá");
    expect(corpoEnviado()).toEqual({ content: "Olá" });
  });

  it("réplica leva `parent_comment_id`", async () => {
    await createComment("t-1", "Respondendo", "c-pai");
    expect(corpoEnviado()).toEqual({
      content: "Respondendo",
      parent_comment_id: "c-pai",
    });
  });

  it("editar manda só o conteúdo novo", async () => {
    await editComment("t-1", "c-1", "Corrigido");
    expect(corpoEnviado()).toEqual({ content: "Corrigido" });
  });
});
