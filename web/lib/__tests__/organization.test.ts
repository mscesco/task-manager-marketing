/**
 * Spec 047, fatia B -- a logica da tela `/organizacao`.
 *
 * ⚠️ Estes testes existem porque `app/` esta FORA do `include` do vitest, e a
 * §7 da spec avisa: *"`temAcaoPossivel` mora em `lib/`, entao tem guardiao. O
 * resto da tela nao."* Toda decisao desta tela mora em `lib/organization.ts`
 * por causa disso.
 */

import { describe, it, expect } from "vitest";
import {
  searchPeople,
  papeisDeOrganizacaoAtribuiveis,
  areaCards,
  matchesSearch,
  organizationManagers,
  peopleWithoutArea,
  podeAbrirOrganizacao,
} from "../organization";
// ⚠️ Importado de OUTRO modulo de proposito: o teste de concordancia entre as
// duas telas so tem valor se ele chamar as duas implementacoes de verdade.
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
  areas: string[],
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
    area_ids: areas,
    team_ids: [],
  };
}

describe("areaCards", () => {
  it("conta pessoas por area e subtimes por arvore", () => {
    const cards = areaCards(TIMES, [
      pessoa("Ana", [MKT]),
      pessoa("Bia", [MKT]),
      pessoa("Caio", [TI]),
    ]);
    expect(cards.map((c) => [c.area.name, c.pessoas, c.subteams])).toEqual([
      ["Marketing", 2, 2], // SEO + SEO Junior
      ["TI", 1, 0],
    ]);
  });

  it("⚠️ NAO duplica quem esta na area E num subtime dela", () => {
    // ⚠️ E o cadastro normal de quem coordena. Somar o `membros` de cada time
    // da arvore -- a implementacao obvia -- contaria esta pessoa duas vezes,
    // e o card diria uma a mais. O backend ja deduplica com `DISTINCT`; este
    // teste garante que a tela nao reintroduza a soma.
    const cards = areaCards(TIMES, [pessoa("Ana", [MKT])]);
    expect(cards[0].pessoas).toBe(1);
  });

  it("conta neto como subtime -- a arvore tem tres niveis", () => {
    expect(areaCards(TIMES, [])[0].subteams).toBe(2);
  });

  it("⚠️ NAO conta inativo -- o card diz quem trabalha ali", () => {
    // ⚠️ Reportado pela Camila em 10/09, na tela: o card do Marketing dizia
    // "8 pessoas" contando quem ja saiu. O inativo continua tendo aba propria
    // na tela da area, com o proprio numero -- nada o esconde.
    const cards = areaCards(TIMES, [
      pessoa("Ana", [MKT]),
      pessoa("Bia", [MKT], { is_active: false }),
    ]);
    expect(cards[0].pessoas).toBe(1);
  });

  it("⚠️ concorda com `subteamCards`: a regra de inativo e UMA", () => {
    // ⚠️⚠️ ESTE TESTE AMARRA DUAS TELAS. `subteamCards` (tela de time) e
    // `areaCards` (tela da organizacao) contam pessoas para o MESMO tipo de
    // cartao; se uma passar a incluir inativo e a outra nao, o mesmo subtime
    // mostra dois numeros em telas diferentes -- e ninguem ve as duas lado a
    // lado, entao o defeito vive muito tempo.
    const so = [time(MKT, "Marketing", null), time(SEO, "SEO", MKT)];
    const vinculo = [{ team_id: SEO, role: "OPERATOR" as const }];
    const gente: Member[] = [
      { ...pessoa("Ana", [MKT]), memberships: vinculo },
      { ...pessoa("Bia", [MKT], { is_active: false }), memberships: vinculo },
    ];
    expect(areaCards(so, gente)[0].pessoas).toBe(
      subteamCards(MKT, so, gente)[0].pessoas,
    );
  });

  it("area vazia mostra zero, e nao some da grade", () => {
    const cards = areaCards(TIMES, []);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.pessoas === 0)).toBe(true);
  });

  it("as areas vem ordenadas por nome", () => {
    const invertido = [TIMES[3], TIMES[0], TIMES[1], TIMES[2]];
    expect(areaCards(invertido, []).map((c) => c.area.name)).toEqual([
      "Marketing",
      "TI",
    ]);
  });
});

describe("peopleWithoutArea", () => {
  it("⭐ acha quem nao esta em area nenhuma", () => {
    // ⚠️ Sem este card a pessoa NAO APARECE em lugar nenhum do produto -- a
    // grade e feita de areas. E nao e hipotetico: a conta de administracao da
    // Camila esta assim desde 08/09, de proposito.
    const soltas = peopleWithoutArea([
      pessoa("Ana", [MKT]),
      pessoa("Admin", []),
    ]);
    expect(soltas.map((m) => m.name)).toEqual(["Admin"]);
  });

  it("⚠️ NAO confunde 'so na area' com 'sem area'", () => {
    // O erro que `team_ids` produziria: quem esta apenas na raiz tem
    // `team_ids` vazio -- e cairia aqui junto com os gerentes.
    const gerente: Member = { ...pessoa("Gerente", [MKT]), team_ids: [] };
    expect(peopleWithoutArea([gerente])).toEqual([]);
  });

  it("trata a ausencia do campo como 'sem area'", () => {
    // Respostas de MUTACAO nao resolvem `area_ids`; a tela nunca deve quebrar
    // por causa disso.
    const semCampo = { ...pessoa("X", []), area_ids: undefined } as Member;
    expect(peopleWithoutArea([semCampo]).map((m) => m.name)).toEqual(["X"]);
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
  it("⭐ diz em QUAIS areas a pessoa esta -- a pergunta que a grade esconde", () => {
    const achadas = searchPeople("ana", [pessoa("Ana", [MKT, TI])], TIMES);
    expect(achadas[0].areas.map((t) => t.name)).toEqual(["Marketing", "TI"]);
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
    // ⚠️ Sem isto, abrir a tela despejaria todo mundo embaixo da grade.
    expect(searchPeople("", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
    expect(searchPeople("   ", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
  });

  it("quem nao tem area aparece na busca, com lista de areas vazia", () => {
    // ⚠️ Ela precisa ser ACHAVEL: e justamente quem a grade nao mostra.
    const achadas = searchPeople("admin", [pessoa("Admin", [])], TIMES);
    expect(achadas).toHaveLength(1);
    expect(achadas[0].areas).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("⭐ ignora acento — a divergência que o code review achou", () => {
    // ⚠️ `/membros` nascera com `toLowerCase()` puro: "jose" achava "José" na
    // `/organizacao` e ninguém na outra tela. Mesma pessoa, mesmo term, duas
    // respostas. Agora as duas perguntam AQUI.
    expect(matchesSearch("jose", pessoa("José", [MKT]))).toBe(true);
    expect(matchesSearch("JOSÉ", pessoa("Jose", [MKT]))).toBe(true);
  });

  it("casa por e-mail também", () => {
    const ana = pessoa("Ana", [MKT], { email: "ana.silva@fecaf.com.br" });
    expect(matchesSearch("silva", ana)).toBe(true);
  });

  it("term vazio casa com todo mundo — quem decide filtrar é a tela", () => {
    // ⚠️ Ao contrário de `searchPeople`, que devolve vazio: lá o term vazio
    // significa "não busquei nada"; aqui é um predicado por pessoa, e a tela
    // é que decide se está filtrando.
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
    // O defeito: a pagina abria para quem digitasse o endereco. O papel de
    // TIME (inclusive o ADMIN antigo de time) nao entra: a pergunta e so
    // `org_role`.
    expect(podeAbrirOrganizacao({ org_role: null })).toBe(false);
    expect(podeAbrirOrganizacao({})).toBe(false);
  });

  it("ainda carregando e nao -- nada da organizacao por palpite", () => {
    expect(podeAbrirOrganizacao(null)).toBe(false);
    expect(podeAbrirOrganizacao(undefined)).toBe(false);
  });
});
