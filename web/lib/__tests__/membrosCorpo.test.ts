/**
 * O corpo que sai nas escritas de membro. Os testes de tela mockam estas
 * funções: campo renomeado ou perdido aqui só cai neste `toEqual`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assignMemberToTeam, changeMemberRole, createMember } from "../api";

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

describe("escritas de membro: o corpo inteiro", () => {
  it("createMember leva `teamId` como `team_id`", async () => {
    await createMember({
      name: "Ana",
      email: "ana@exemplo.com",
      teamId: "team-crm",
      role: "OPERATOR",
    });
    expect(corpoEnviado()).toEqual({
      name: "Ana",
      email: "ana@exemplo.com",
      team_id: "team-crm",
      role: "OPERATOR",
    });
  });

  it("changeMemberRole manda só o papel (o time vai na URL)", async () => {
    await changeMemberRole("u-ana", "team-crm", "SUPERVISOR");
    expect(corpoEnviado()).toEqual({ role: "SUPERVISOR" });
  });

  it("assignMemberToTeam manda o time e o papel", async () => {
    await assignMemberToTeam("u-ana", "team-crm", "MANAGER");
    expect(corpoEnviado()).toEqual({ team_id: "team-crm", role: "MANAGER" });
  });
});
