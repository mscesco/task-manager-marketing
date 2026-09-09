/**
 * Spec 047, fatia B -- a logica da tela `/organizacao`.
 *
 * ⚠️ Estes testes existem porque `app/` esta FORA do `include` do vitest, e a
 * §7 da spec avisa: *"`temAcaoPossivel` mora em `lib/`, entao tem guardiao. O
 * resto da tela nao."* Toda decisao desta tela mora em `lib/organizacao.ts`
 * por causa disso.
 */

import { describe, it, expect } from "vitest";
import {
  buscarPessoas,
  cardsDeArea,
  casaComBusca,
  gestoresDaOrganizacao,
  pessoasSemArea,
} from "../organizacao";
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
  extra: { email?: string; org_role?: OrgRole | null } = {},
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: extra.email ?? `${nome.toLowerCase()}@t.dev`,
    is_active: true,
    org_role: extra.org_role ?? null,
    area_ids: areas,
    team_ids: [],
  };
}

describe("cardsDeArea", () => {
  it("conta pessoas por area e subtimes por arvore", () => {
    const cards = cardsDeArea(TIMES, [
      pessoa("Ana", [MKT]),
      pessoa("Bia", [MKT]),
      pessoa("Caio", [TI]),
    ]);
    expect(cards.map((c) => [c.area.name, c.pessoas, c.subtimes])).toEqual([
      ["Marketing", 2, 2], // SEO + SEO Junior
      ["TI", 1, 0],
    ]);
  });

  it("⚠️ NAO duplica quem esta na area E num subtime dela", () => {
    // ⚠️ E o cadastro normal de quem coordena. Somar o `membros` de cada time
    // da arvore -- a implementacao obvia -- contaria esta pessoa duas vezes,
    // e o card diria uma a mais. O backend ja deduplica com `DISTINCT`; este
    // teste garante que a tela nao reintroduza a soma.
    const cards = cardsDeArea(TIMES, [pessoa("Ana", [MKT])]);
    expect(cards[0].pessoas).toBe(1);
  });

  it("conta neto como subtime -- a arvore tem tres niveis", () => {
    expect(cardsDeArea(TIMES, [])[0].subtimes).toBe(2);
  });

  it("area vazia mostra zero, e nao some da grade", () => {
    const cards = cardsDeArea(TIMES, []);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.pessoas === 0)).toBe(true);
  });

  it("as areas vem ordenadas por nome", () => {
    const invertido = [TIMES[3], TIMES[0], TIMES[1], TIMES[2]];
    expect(cardsDeArea(invertido, []).map((c) => c.area.name)).toEqual([
      "Marketing",
      "TI",
    ]);
  });
});

describe("pessoasSemArea", () => {
  it("⭐ acha quem nao esta em area nenhuma", () => {
    // ⚠️ Sem este card a pessoa NAO APARECE em lugar nenhum do produto -- a
    // grade e feita de areas. E nao e hipotetico: a conta de administracao da
    // Camila esta assim desde 08/09, de proposito.
    const soltas = pessoasSemArea([
      pessoa("Ana", [MKT]),
      pessoa("Admin", []),
    ]);
    expect(soltas.map((m) => m.name)).toEqual(["Admin"]);
  });

  it("⚠️ NAO confunde 'so na area' com 'sem area'", () => {
    // O erro que `team_ids` produziria: quem esta apenas na raiz tem
    // `team_ids` vazio -- e cairia aqui junto com os gerentes.
    const gerente: Member = { ...pessoa("Gerente", [MKT]), team_ids: [] };
    expect(pessoasSemArea([gerente])).toEqual([]);
  });

  it("trata a ausencia do campo como 'sem area'", () => {
    // Respostas de MUTACAO nao resolvem `area_ids`; a tela nunca deve quebrar
    // por causa disso.
    const semCampo = { ...pessoa("X", []), area_ids: undefined } as Member;
    expect(pessoasSemArea([semCampo]).map((m) => m.name)).toEqual(["X"]);
  });
});

describe("gestoresDaOrganizacao", () => {
  it("traz so quem tem papel de organizacao, ADMIN primeiro", () => {
    const gestores = gestoresDaOrganizacao([
      pessoa("Zeca", [], { org_role: "GESTOR" }),
      pessoa("Ana", [MKT]),
      pessoa("Camila", [], { org_role: "ADMIN" }),
    ]);
    expect(gestores.map((m) => m.name)).toEqual(["Camila", "Zeca"]);
  });

  it("sem gestor nenhum, lista vazia", () => {
    expect(gestoresDaOrganizacao([pessoa("Ana", [MKT])])).toEqual([]);
  });
});

describe("buscarPessoas", () => {
  it("⭐ diz em QUAIS areas a pessoa esta -- a pergunta que a grade esconde", () => {
    const achadas = buscarPessoas("ana", [pessoa("Ana", [MKT, TI])], TIMES);
    expect(achadas[0].areas.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("ignora acento e caixa", () => {
    const jose = pessoa("José", [MKT]);
    expect(buscarPessoas("jose", [jose], TIMES)).toHaveLength(1);
    expect(buscarPessoas("JOSÉ", [jose], TIMES)).toHaveLength(1);
  });

  it("casa tambem por e-mail", () => {
    const ana = pessoa("Ana", [MKT], { email: "ana.silva@fecaf.com.br" });
    expect(buscarPessoas("silva", [ana], TIMES)).toHaveLength(1);
  });

  it("termo vazio nao lista o workspace inteiro", () => {
    // ⚠️ Sem isto, abrir a tela despejaria todo mundo embaixo da grade.
    expect(buscarPessoas("", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
    expect(buscarPessoas("   ", [pessoa("Ana", [MKT])], TIMES)).toEqual([]);
  });

  it("quem nao tem area aparece na busca, com lista de areas vazia", () => {
    // ⚠️ Ela precisa ser ACHAVEL: e justamente quem a grade nao mostra.
    const achadas = buscarPessoas("admin", [pessoa("Admin", [])], TIMES);
    expect(achadas).toHaveLength(1);
    expect(achadas[0].areas).toEqual([]);
  });
});

describe("casaComBusca", () => {
  it("⭐ ignora acento — a divergência que o code review achou", () => {
    // ⚠️ `/membros` nascera com `toLowerCase()` puro: "jose" achava "José" na
    // `/organizacao` e ninguém na outra tela. Mesma pessoa, mesmo termo, duas
    // respostas. Agora as duas perguntam AQUI.
    expect(casaComBusca("jose", pessoa("José", [MKT]))).toBe(true);
    expect(casaComBusca("JOSÉ", pessoa("Jose", [MKT]))).toBe(true);
  });

  it("casa por e-mail também", () => {
    const ana = pessoa("Ana", [MKT], { email: "ana.silva@fecaf.com.br" });
    expect(casaComBusca("silva", ana)).toBe(true);
  });

  it("termo vazio casa com todo mundo — quem decide filtrar é a tela", () => {
    // ⚠️ Ao contrário de `buscarPessoas`, que devolve vazio: lá o termo vazio
    // significa "não busquei nada"; aqui é um predicado por pessoa, e a tela
    // é que decide se está filtrando.
    expect(casaComBusca("", pessoa("Ana", [MKT]))).toBe(true);
    expect(casaComBusca("   ", pessoa("Ana", [MKT]))).toBe(true);
  });

  it("não casa quem não tem o termo", () => {
    expect(casaComBusca("zeca", pessoa("Ana", [MKT]))).toBe(false);
  });
});
