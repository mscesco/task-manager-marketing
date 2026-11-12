/**
 * O corpo que sai no `POST /projects`. `createProject` monta o corpo campo a
 * campo e os testes de tela mockam a função: campo descartado aqui só cai neste
 * `toEqual` do corpo inteiro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProject } from "../api";

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

// `team_id` vai sempre: sem ele, `createProject` busca a raiz com OUTRO `fetch`,
// que viraria a chamada [0].
describe("createProject: o corpo que realmente sai", () => {
  it("com todos os campos, o corpo inteiro", async () => {
    await createProject({
      title: "Campanha",
      description: "corpo",
      status: "ACTIVE",
      priority: "HIGH",
      start_date: "2026-08-01",
      due_date: "2026-09-01",
      team_id: "team-crm",
    });
    expect(corpoEnviado()).toEqual({
      title: "Campanha",
      team_id: "team-crm",
      description: "corpo",
      status: "ACTIVE",
      priority: "HIGH",
      start_date: "2026-08-01",
      due_date: "2026-09-01",
    });
  });

  it("só o mínimo: status, prioridade e datas ausentes não viajam", async () => {
    await createProject({ title: "Campanha", team_id: "team-crm" });
    expect(corpoEnviado()).toEqual({
      title: "Campanha",
      team_id: "team-crm",
      description: "",
    });
  });

  it("data `null` viaja como `null`: é diferente de ausente", async () => {
    await createProject({
      title: "Campanha",
      team_id: "team-crm",
      start_date: null,
      due_date: null,
    });
    expect(corpoEnviado()).toEqual({
      title: "Campanha",
      team_id: "team-crm",
      description: "",
      start_date: null,
      due_date: null,
    });
  });
});
