/**
 * O corpo que sai no `POST /tasks`. `createTask` monta o corpo campo a campo, e
 * mock do cliente HTTP esconde campo que o cliente não repassa: campo novo no
 * `TaskCreateInput` ganha lugar no `toEqual` daqui.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createTask } from "../api";

const RESPOSTA = { id: "t-nova", title: "Tarefa nova" };

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

// `team_id` vai sempre: sem ele, `createTask` busca a raiz com OUTRO `fetch`,
// que viraria a chamada [0] e `corpoEnviado()` leria a requisição errada.
const BASE = { title: "Tarefa nova", team_id: "team-crm" };

describe("createTask: o corpo que realmente sai", () => {
  it("com todos os campos, o corpo inteiro", async () => {
    await createTask({
      ...BASE,
      description: "corpo",
      priority: "HIGH",
      start_date: "2026-08-01",
      due_date: "2026-09-01",
      due_time: "14:30",
      project_id: "p-1",
      assignee_ids: ["u-ana"],
      watcher_ids: ["u-bia"],
      board_id: "board-campanhas",
    });
    expect(corpoEnviado()).toEqual({
      title: "Tarefa nova",
      description: "corpo",
      priority: "HIGH",
      start_date: "2026-08-01",
      due_date: "2026-09-01",
      due_time: "14:30",
      team_id: "team-crm",
      project_id: "p-1",
      assignee_ids: ["u-ana"],
      watcher_ids: ["u-bia"],
      board_id: "board-campanhas",
    });
  });

  it("só o mínimo: datas vão como null, listas vazias e board_id somem", async () => {
    // `board_id` ausente faz o backend usar o Quadro geral; as datas, ao
    // contrário, têm `null` como valor.
    await createTask({ ...BASE, board_id: null, assignee_ids: [], watcher_ids: [] });
    expect(corpoEnviado()).toEqual({
      title: "Tarefa nova",
      description: "",
      start_date: null,
      due_date: null,
      due_time: null,
      team_id: "team-crm",
    });
  });
});
