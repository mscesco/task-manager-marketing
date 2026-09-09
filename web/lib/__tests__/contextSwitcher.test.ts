/**
 * Spec 047, revisão de 09/09 — o que a barra mostra acima do nome da pessoa.
 *
 * ⚠️ POR QUE ESTES TESTES EXISTEM: nenhum erro aqui dá tela vermelha. Errar
 * some com um caminho de navegação, ou mostra a alguém uma lista de áreas que
 * não é dela — e as duas coisas passam pelos portões sem um ruído.
 *
 * SABOTAGENS medidas -- ver o fim do arquivo.
 */

import { describe, it, expect } from "vitest";
import {
  contextChoice,
  peopleEntry,
  rootsForPerson,
} from "../contextSwitcher";
import type { CurrentUser, Team } from "../api";

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const TI = "t-ti";

function time(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  time(TI, "TI", null),
  time(MKT, "Marketing", null),
  time(SEO, "SEO", MKT),
  time(JR, "SEO Junior", SEO),
];

function pessoa(vinculos: string[]): CurrentUser {
  return {
    id: "u-1",
    name: "Fulano",
    email: "fulano@t.dev",
    must_change_password: false,
    roles: [],
    permissions: [],
    teams: vinculos.map((team_id) => ({ team_id, role: "OPERATOR" as const })),
  } as unknown as CurrentUser;
}

describe("rootsForPerson", () => {
  it("⭐ quem está SÓ num subtime enxerga a área dele", () => {
    // ⚠️ A raiz sai do vínculo RESOLVIDO na árvore, e não do vínculo direto.
    // Com o vínculo direto, quem está apenas no SEO Junior ficaria sem
    // contexto nenhum na barra — e é metade da equipe.
    const raizes = rootsForPerson(TIMES, pessoa([JR]), false);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing"]);
  });

  it("⭐⭐ quem NÃO administra a organização não vê a área alheia", () => {
    // ⚠️ Não é cosmético: para um operador do Marketing, "TI" na lista é uma
    // tela que ele abre e não entende — ou que o servidor recusa.
    const raizes = rootsForPerson(TIMES, pessoa([SEO]), false);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing"]);
    expect(raizes.map((t) => t.id)).not.toContain(TI);
  });

  it("quem administra a organização vê TODAS, mesmo sem vínculo nenhum", () => {
    // ⚠️ E este é o caso real da conta de administração da Camila, sem área
    // desde 08/09, de propósito (passo 2 da Spec 045).
    const raizes = rootsForPerson(TIMES, pessoa([]), true);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("quem está em duas áreas vê as duas, ordenadas por nome", () => {
    const raizes = rootsForPerson(TIMES, pessoa([SEO, TI]), false);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("sem usuário carregado, lista vazia — e não o workspace inteiro", () => {
    expect(rootsForPerson(TIMES, null, false)).toEqual([]);
  });
});

describe("contextChoice", () => {
  it("⭐⭐ uma área e sem poder na organização: RÓTULO, não seletor", () => {
    // ⚠️ A regra combinada em 19/08 e repetida em 09/09. Não há para onde ir,
    // e item clicável que não leva a lugar nenhum é pior que um rótulo — a
    // regra "se parece clicável, tem de ser clicável" vale ao contrário.
    const escolha = contextChoice(TIMES, pessoa([SEO]), false);
    expect(escolha.kind).toBe("label");
    if (escolha.kind === "label") expect(escolha.team.name).toBe("Marketing");
  });

  it("⭐ duas áreas: vira seletor, mesmo sem poder na organização", () => {
    const escolha = contextChoice(TIMES, pessoa([SEO, TI]), false);
    expect(escolha.kind).toBe("switcher");
    if (escolha.kind === "switcher") {
      expect(escolha.roots.map((t) => t.name)).toEqual(["Marketing", "TI"]);
      expect(escolha.canManageOrg).toBe(false);
    }
  });

  it("⭐⭐ quem administra a organização vê o seletor mesmo com UMA área", () => {
    // ⚠️ Porque "Gerenciar a organização" mora dentro dele, e é a ÚNICA porta
    // para aquela tela desde que ela saiu do menu. Virar rótulo aqui
    // esconderia a porta justamente de quem precisa dela.
    const umaArea = [TIMES[1], TIMES[2]];
    const escolha = contextChoice(umaArea, pessoa([SEO]), true);
    expect(escolha.kind).toBe("switcher");
    if (escolha.kind === "switcher") expect(escolha.canManageOrg).toBe(true);
  });

  it("sem área e sem poder: não mostra nada", () => {
    expect(contextChoice(TIMES, pessoa([]), false).kind).toBe("none");
  });

  it("⚠️ a lista NUNCA traz subtime", () => {
    // ⚠️ Pedido literal da Camila: *"subtimes não são para aparecer ali, só
    // times raiz e a opção de gerenciar a organização"*. O seletor responde
    // "em qual ÁREA estou"; subtime é navegação dentro da área.
    const escolha = contextChoice(TIMES, pessoa([]), true);
    if (escolha.kind !== "switcher") throw new Error("esperava seletor");
    const ids = escolha.roots.map((t) => t.id);
    expect(ids).not.toContain(SEO);
    expect(ids).not.toContain(JR);
  });
});

describe("peopleEntry", () => {
  it("uma área: cai na tela dela", () => {
    expect(peopleEntry([TIMES[1]])).toEqual({ kind: "team", teamId: MKT });
  });

  it("⚠️ várias: a PRIMEIRA POR NOME, e não a primeira da API", () => {
    // ⚠️ Mesma razão de `entradaDoQuadro`: a ordem da API não é contrato de
    // ninguém. Sem ordenar, duas visitas seguidas cairiam em áreas
    // diferentes sem a pessoa ter mudado nada.
    const raizes = [TIMES[1], TIMES[0]].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    expect(peopleEntry(raizes)).toEqual({ kind: "team", teamId: MKT });
  });

  it("nenhuma área: não inventa destino", () => {
    expect(peopleEntry([])).toEqual({ kind: "none" });
  });
});

// SABOTAGENS medidas (contando também os testes de desenho, em
// `components/__tests__/ContextSwitcher.test.tsx` -- 20 no total):
//   A. Resolver a raiz pelo vínculo DIRETO, sem subir a árvore. **Cai 9**:
//      quem está só num subtime perde o contexto, e a barra inteira muda.
//   B. Devolver todas as raízes para todo mundo. **Cai 7**.
//   C. Virar rótulo quando há uma área só, ignorando `canManageOrg`.
//      **Cai 3**: some a única porta para a tela de organização.
