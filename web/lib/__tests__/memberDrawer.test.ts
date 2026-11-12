import { describe, expect, it } from "vitest";

import type { MemberRole, MemberTeamComCadeado, Team } from "../api";
import { drawerMemberships } from "../memberDrawer";

const time = (id: string, name: string, parent_team_id: string | null = null): Team => ({
  id,
  workspace_id: "w-1",
  parent_team_id,
  name,
  slug: id,
});

const CRM = time("crm", "CRM");
const COPY = time("copy", "Copy", "crm");
const ADS = time("ads", "Ads", "crm");
const TIMES = [CRM, COPY, ADS];

const vinculo = (team_id: string, role: MemberRole): MemberTeamComCadeado => ({
  team_id,
  role,
  can_edit_role: true,
});

// Só o que o painel decide: o time, de onde vem a autoridade e se é raiz.
const resumo = (v: MemberTeamComCadeado[]) =>
  drawerMemberships(v, TIMES).map((l) => ({
    team: l.team.id,
    autoridadeVemDe: l.autoridadeVemDe?.id ?? null,
    isRoot: l.isRoot,
  }));

describe("drawerMemberships", () => {
  it("MANAGER da raiz: o subtime vira alocação que vem da raiz", () => {
    expect(resumo([vinculo("copy", "OPERATOR"), vinculo("crm", "MANAGER")])).toEqual([
      { team: "crm", autoridadeVemDe: null, isRoot: true },
      { team: "copy", autoridadeVemDe: "crm", isRoot: false },
    ]);
  });

  it("SUPERVISOR da raiz não dá comando: o subtime segue cargo próprio", () => {
    expect(resumo([vinculo("copy", "OPERATOR"), vinculo("crm", "SUPERVISOR")])).toEqual([
      { team: "crm", autoridadeVemDe: null, isRoot: true },
      { team: "copy", autoridadeVemDe: null, isRoot: false },
    ]);
  });

  it("vínculo com time que a lista não tem some do painel", () => {
    expect(resumo([vinculo("sumiu", "MANAGER"), vinculo("ads", "OPERATOR")])).toEqual([
      { team: "ads", autoridadeVemDe: null, isRoot: false },
    ]);
  });

  it("a raiz vem primeiro, depois os subtimes por nome", () => {
    const linhas = resumo([
      vinculo("copy", "OPERATOR"),
      vinculo("ads", "OPERATOR"),
      vinculo("crm", "OPERATOR"),
    ]);
    expect(linhas.map((l) => l.team)).toEqual(["crm", "ads", "copy"]);
  });
});
