// `computeLens`: quais quadros aparecem no menu.

import { describe, it, expect } from "vitest";
import { computeLens } from "../lens";
import type { Team, TeamMembership } from "../api";

const RAIZ = "t-raiz";
const SEO = "t-seo";
const CRM = "t-crm";

function time(id: string, nome: string, parent: string | null): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: parent,
    name: nome,
    slug: id,
  };
}

const TIMES: Team[] = [
  time(RAIZ, "Marketing", null),
  time(SEO, "SEO", RAIZ),
  time(CRM, "CRM", RAIZ),
];

function vinculo(team_id: string, role: string): TeamMembership {
  return { team_id, role } as TeamMembership;
}

describe("computeLens -- admin de ORGANIZACAO, sem vinculo nenhum", () => {
  it("⭐⭐ enxerga todos os subtimes -- a regressao de 09/09", () => {
    // Papel na organização e zero vínculos de time.
    const lens = computeLens([], TIMES, ["ADMIN"], RAIZ);

    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual(
      [CRM, SEO].sort(),
    );
    expect(lens.visibleTeamIds.has(SEO)).toBe(true);
    expect(lens.visibleTeamIds.has(CRM)).toBe(true);
  });

  it("⚠️ e SEM o papel a lente sai VAZIA -- o defeito, preservado", () => {
    // Sem `roles`, a lente sai vazia.
    const lens = computeLens([], TIMES, [], RAIZ);

    expect(lens.boardSubteams).toEqual([]);
    expect(lens.visibleTeamIds.size).toBe(0);
  });

  it("a raiz e a que veio de fora, e nao a que a lista trouxe primeiro", () => {
    expect(computeLens([], TIMES, ["ADMIN"], RAIZ).rootId).toBe(RAIZ);
  });

  it("⭐ Spec 051, fatia F: o GESTOR sem vinculo tambem ve tudo", () => {
    const lens = computeLens([], TIMES, ["GESTOR"], RAIZ);

    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual([CRM, SEO].sort());
    expect(lens.visibleTeamIds.has(RAIZ)).toBe(true);
    expect(lens.visibleTeamIds.has(SEO)).toBe(true);
  });
});

describe("computeLens -- o que NAO pode mudar", () => {
  it("⚠️ MANAGER ve a arvore DELE, e nao tudo", () => {
    // Derivar "vê tudo" de `permissions` passaria aqui: MANAGER também tem `team.manage`.
    const lens = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, ["MANAGER"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual(
      [CRM, SEO].sort(),
    );
  });

  it("OPERATOR de um subtime ve o subtime dele + a raiz", () => {
    const lens = computeLens([vinculo(SEO, "OPERATOR")], TIMES, ["OPERATOR"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.id)).toEqual([SEO]);
    expect(lens.visibleTeamIds.has(RAIZ)).toBe(true);
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("SUPERVISOR de um subtime NAO ve o subtime irmao", () => {
    const lens = computeLens(
      [vinculo(SEO, "SUPERVISOR")],
      TIMES,
      ["SUPERVISOR"],
      RAIZ,
    );
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("as sub-abas vem ordenadas por nome (pt-BR)", () => {
    // A ordem tem de ser a mesma nos dois caminhos.
    const doAdmin = computeLens([], TIMES, ["ADMIN"], RAIZ);
    const doManager = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, [], RAIZ);
    expect(doAdmin.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
    expect(doManager.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
  });

  it("o vinculo ADMIN LEGADO continua enxergando tudo", () => {
    // O vínculo ADMIN antigo de time chega em `roles` do mesmo jeito.
    const lens = computeLens([vinculo(RAIZ, "ADMIN")], TIMES, ["ADMIN"], RAIZ);
    expect(lens.boardSubteams).toHaveLength(2);
  });
});

describe("computeLens -- o recorte por TIME ATIVO (Spec 048, fatia B)", () => {
  // Duas raízes.
  const COM = "t-com";
  const VENDAS = "t-vendas";
  const DOIS: Team[] = [
    ...TIMES,
    time(COM, "Comercial", null),
    time(VENDAS, "Vendas", COM),
  ];

  it("⚠️⚠️ o ADMIN vê os subtimes DO TIME ATIVO, e não a árvore inteira", () => {
    // Para ADMIN, só os subtimes do time ativo, não os de todos.
    const noMkt = computeLens([], DOIS, ["ADMIN"], RAIZ);
    expect(noMkt.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);

    const noCom = computeLens([], DOIS, ["ADMIN"], COM);
    expect(noCom.boardSubteams.map((t) => t.name)).toEqual(["Vendas"]);
  });

  it("⚠️ trocar de time ativo TROCA o menu -- a promessa do seletor", () => {
    const a = computeLens([], DOIS, ["ADMIN"], RAIZ).boardSubteams;
    const b = computeLens([], DOIS, ["ADMIN"], COM).boardSubteams;
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
  });

  it("⚠️ o MANAGER de um time não vê subtime do outro, nem com ele ativo", () => {
    // Recorte por time e lente se somam.
    const lens = computeLens([vinculo(RAIZ, "MANAGER")], DOIS, ["MANAGER"], COM);
    expect(lens.boardSubteams).toEqual([]);
  });

  it("⚠️ `rootId` é o time ativo -- é dele que sai o link do Quadro geral", () => {
    expect(computeLens([], DOIS, ["ADMIN"], COM).rootId).toBe(COM);
  });

  it("⚠⚠ sem time ativo, o menu fica VAZIO -- falha fechada", () => {
    // `null` devolve vazio, não "todos".
    expect(computeLens([], DOIS, ["ADMIN"], null).boardSubteams).toEqual([]);
    expect(computeLens([], DOIS, ["ADMIN"], null).rootId).toBeNull();
  });

  it("subtime de NETO conta como do time raiz", () => {
    // A árvore tem três níveis: um neto pertence ao time raiz do avô.
    const NETO = "t-neto";
    const tres = [...DOIS, time(NETO, "SEO Junior", SEO)];
    const lens = computeLens([], tres, ["ADMIN"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.name)).toEqual([
      "CRM",
      "SEO",
      "SEO Junior",
    ]);
  });
});
