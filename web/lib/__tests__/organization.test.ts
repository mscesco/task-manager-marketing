// Lógica da tela `/organizacao` (`app/` fica fora do vitest, por isso a regra mora em `lib/`).

import { describe, it, expect } from "vitest";
import {
  searchPeople,
  papeisDeOrganizacaoAtribuiveis,
  rootTeamCards,
  matchesSearch,
  organizationManagers,
  peopleWithoutRoot,
  podeAbrirOrganizacao,
} from "../organization";
// Importado de outro módulo de propósito: o teste de concordância chama as duas implementações.
import { subteamCards } from "../teamScreen";
import type { Member, Team, OrgRole } from "../api";

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const TI = "t-ti";

function time(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  time(MKT, "Marketing", null),
  time(SEO, "SEO", MKT),
  time(JR, "SEO Junior", SEO),
  time(TI, "TI", null),
];

function pessoa(
  nome: string,
  roots: string[],
  extra: {
    email?: string;
    org_role?: OrgRole | null;
    is_active?: boolean;
  } = {},
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: extra.email ?? `${nome.toLowerCase()}@t.dev`,
    is_active: extra.is_active ?? true,
    org_role: extra.org_role ?? null,
    root_team_ids: roots,
    team_ids: [],
  };
}

describe("rootTeamCards", () => {
  it("conta pessoas por time raiz e subtimes por arvore", () => {
    const cards = rootTeamCards(TIMES, [
      pessoa("Ana", [MKT]),
      pessoa("Bia", [MKT]),
      pessoa("Caio", [TI]),
    ]);
    expect(cards.map((c) => [c.root.name, c.pessoas, c.subteams])).toEqual([
      ["Marketing", 2, 2], // SEO + SEO Junior
      ["TI", 1, 0],
    ]);
  });

  it("⚠️ NAO duplica quem esta no time E num subtime dele", () => {
    // Somar os membros de cada time da árvore contaria esta pessoa duas vezes.
    const cards = rootTeamCards(TIMES, [pessoa("Ana", [MKT])]);
    expect(cards[0].pessoas).toBe(1);
  });

  it("conta neto como subtime -- a arvore tem tres niveis", () => {
    expect(rootTeamCards(TIMES, [])[0].subteams).toBe(2);
  });

  it("⚠️ NAO conta inativo -- o card diz quem trabalha ali", () => {
    // O inativo tem aba própria na tela do time.
    const cards = rootTeamCards(TIMES, [
      pessoa("Ana", [MKT]),
      pessoa("Bia", [MKT], { is_active: false }),
    ]);
    expect(cards[0].pessoas).toBe(1);
  });

  it("⚠️ concorda com `subteamCards`: a regra de inativo e UMA", () => {
    // Amarra duas telas: o mesmo tipo de cartão não pode contar diferente.
    const so = [time(MKT, "Marketing", null), time(SEO, "SEO", MKT)];
    const vinculo = [{ team_id: SEO, role: "OPERATOR" as const }];
    const gente: Member[] = [
      { ...pessoa("Ana", [MKT]), memberships: vinculo },
      { ...pessoa("Bia", [MKT], { is_active: false }), memberships: vinculo },
    ];
    expect(rootTeamCards(so, gente)[0].pessoas).toBe(
      subteamCards(MKT, so, gente)[0].pessoas,
    );
  });

  it("time vazio mostra zero, e nao some da grade", () => {
    const cards = rootTeamCards(TIMES, []);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.pessoas === 0)).toBe(true);
  });

  it("os times raiz vem ordenados por nome", () => {
    const invertido = [TIMES[3], TIMES[0], TIMES[1], TIMES[2]];
    expect(rootTeamCards(invertido, []).map((c) => c.root.name)).toEqual([
      "Marketing",
      "TI",
    ]);
  });
});

describe("peopleWithoutRoot", () => {
  it("⭐ acha quem nao esta em time nenhum", () => {
    // Sem este cartão a pessoa não aparece em lugar nenhum do produto.
    const soltas = peopleWithoutRoot([
      pessoa("Ana", [MKT]),
      pessoa("Admin", []),
    ]);
    expect(soltas.map((m) => m.name)).toEqual(["Admin"]);
  });

  it("⚠️ NAO confunde 'so no time raiz' com 'sem time'", () => {
    // Quem está só na raiz tem `team_ids` vazio; por isso a regra usa `root_team_ids`.
    const gerente: Member = { ...pessoa("Gerente", [MKT]), team_ids: [] };
    expect(peopleWithoutRoot([gerente])).toEqual([]);
  });

  it("trata a ausencia do campo como 'sem time'", () => {
    // Respostas de mutação não trazem `root_team_ids`.
    const semCampo = { ...pessoa("X", []), root_team_ids: undefined } as Member;
    expect(peopleWithoutRoot([semCampo]).map((m) => m.name)).toEqual(["X"]);
  });
});

describe("organizationManagers", () => {
  it("traz so quem tem papel de organizacao, ADMIN primeiro", () => {
    const gestores = organizationManagers([
      pessoa("Zeca", [], { org_role: "GESTOR" }),
      pessoa("Ana", [MKT]),
      pessoa("Camila", [], { org_role: "ADMIN" }),
    ]);
    expect(gestores.map((m) => m.name)).toEqual(["Camila", "Zeca"]);
  });

  it("sem gestor nenhum, lista vazia", () => {
    expect(organizationManagers([pessoa("Ana", [MKT])])).toEqual([]);
  });
});

describe("papeisDeOrganizacaoAtribuiveis -- o teto do gestor (Spec 049, fatia G)", () => {
  const ADMIN = { org_role: "ADMIN" as const, permissions: ["org_role.grant"] as const };
  const GESTOR = { org_role: "GESTOR" as const, permissions: ["org_role.grant"] as const };
  const MANAGER = { org_role: null, permissions: ["membership.update"] as const };

  it("o ADMIN dá qualquer papel, a qualquer pessoa", () => {
    expect(papeisDeOrganizacaoAtribuiveis(ADMIN, "ADMIN")).toEqual(["ADMIN", "GESTOR", null]);
    expect(papeisDeOrganizacaoAtribuiveis(ADMIN, null)).toEqual(["ADMIN", "GESTOR", null]);
  });

  it("⚠️ o GESTOR traz para gestor e tira de volta -- e NÃO oferece ADMIN", () => {
    expect(papeisDeOrganizacaoAtribuiveis(GESTOR, null)).toEqual(["GESTOR", null]);
    expect(papeisDeOrganizacaoAtribuiveis(GESTOR, "GESTOR")).toEqual(["GESTOR", null]);
  });

  it("⚠️ o GESTOR NÃO mexe em quem já é ADMIN -- nem para tirar", () => {
    expect(papeisDeOrganizacaoAtribuiveis(GESTOR, "ADMIN")).toBeNull();
  });

  it("sem o verbo, não mexe em ninguém", () => {
    expect(papeisDeOrganizacaoAtribuiveis(MANAGER, null)).toBeNull();
  });
});

describe("searchPeople", () => {
  it("⭐ diz em QUAIS times raiz a pessoa esta -- a pergunta que a grade esconde", () => {
    const achadas = searchPeople("ana", [pessoa("Ana", [MKT, TI])], TIMES);
    expect(achadas[0].roots.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("ignora acento e caixa", () => {
    const jose = pessoa("José", [MKT]);
    expect(searchPeople("jose", [jose], TIMES)).toHaveLength(1);
    expect(searchPeople("JOSÉ", [jose], TIMES)).toHaveLength(1);
  });

  it("casa tambem por e-mail", () => {
    const ana = pessoa("Ana", [MKT], { email: "ana.silva@fecaf.com.br" });
    expect(searchPeople("silva", [ana], TIMES)).toHaveLength(1);
  });

  it("term vazio nao lista o workspace inteiro", () => {
    // Sem isto, abrir a tela listaria todo mundo embaixo da grade.
    expect(searchPeople("", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
    expect(searchPeople("   ", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
  });

  it("quem nao tem time aparece na busca, com lista de times vazia", () => {
    // É justamente quem a grade não mostra.
    const achadas = searchPeople("admin", [pessoa("Admin", [])], TIMES);
    expect(achadas).toHaveLength(1);
    expect(achadas[0].roots).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("⭐ ignora acento — a divergência que o code review achou", () => {
    // As duas telas de pessoas usam esta regra.
    expect(matchesSearch("jose", pessoa("José", [MKT]))).toBe(true);
    expect(matchesSearch("JOSÉ", pessoa("Jose", [MKT]))).toBe(true);
  });

  it("casa por e-mail também", () => {
    const ana = pessoa("Ana", [MKT], { email: "ana.silva@fecaf.com.br" });
    expect(matchesSearch("silva", ana)).toBe(true);
  });

  it("term vazio casa com todo mundo — quem decide filtrar é a tela", () => {
    // Ao contrário de `searchPeople`: aqui é predicado por pessoa.
    expect(matchesSearch("", pessoa("Ana", [MKT]))).toBe(true);
    expect(matchesSearch("   ", pessoa("Ana", [MKT]))).toBe(true);
  });

  it("não casa quem não tem o term", () => {
    expect(matchesSearch("zeca", pessoa("Ana", [MKT]))).toBe(false);
  });
});

describe("podeAbrirOrganizacao -- a guarda da /organizacao (Spec 051, fatia F)", () => {
  it("papel de organizacao abre: ADMIN e GESTOR", () => {
    expect(podeAbrirOrganizacao({ org_role: "ADMIN" })).toBe(true);
    expect(podeAbrirOrganizacao({ org_role: "GESTOR" })).toBe(true);
  });

  it("⚠️ sem papel de organizacao nao abre -- mesmo com vinculo de gerente", () => {
    // Papel de time não entra: a pergunta é só `org_role`.
    expect(podeAbrirOrganizacao({ org_role: null })).toBe(false);
    expect(podeAbrirOrganizacao({})).toBe(false);
  });

  it("ainda carregando e nao -- nada da organizacao por palpite", () => {
    expect(podeAbrirOrganizacao(null)).toBe(false);
    expect(podeAbrirOrganizacao(undefined)).toBe(false);
  });
});
