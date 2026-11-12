// O que a barra mostra: erro aqui some com navegação sem dar tela vermelha.

import { describe, it, expect } from "vitest";
import {
  contextChoice,
  currentContext,
  ownRootTeams,
  peopleEntry,
  peopleEntryFor,
  rootsForPerson,
  switcherHref,
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
  it("⭐ quem está SÓ num subtime enxerga o time raiz dele", () => {
    // A raiz sai do vínculo resolvido na árvore, não do vínculo direto.
    const raizes = rootsForPerson(TIMES, pessoa([JR]), false);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing"]);
  });

  it("quem administra a organização vê TODAS, mesmo sem vínculo nenhum", () => {
    const raizes = rootsForPerson(TIMES, pessoa([]), true);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("quem está em dois times vê os dois, ordenadas por nome", () => {
    const raizes = rootsForPerson(TIMES, pessoa([SEO, TI]), false);
    expect(raizes.map((t) => t.name)).toEqual(["Marketing", "TI"]);
  });

  it("sem usuário carregado, lista vazia — e não o workspace inteiro", () => {
    expect(rootsForPerson(TIMES, null, false)).toEqual([]);
  });
});

describe("contextChoice", () => {
  it("⭐⭐ um time e sem poder na organização: RÓTULO, não seletor", () => {
    const escolha = contextChoice(TIMES, pessoa([SEO]), false);
    expect(escolha.kind).toBe("label");
    if (escolha.kind === "label") expect(escolha.team.name).toBe("Marketing");
  });

  it("⭐ dois times: vira seletor, mesmo sem poder na organização", () => {
    const escolha = contextChoice(TIMES, pessoa([SEO, TI]), false);
    expect(escolha.kind).toBe("switcher");
    if (escolha.kind === "switcher") {
      expect(escolha.roots.map((t) => t.name)).toEqual(["Marketing", "TI"]);
      expect(escolha.canManageOrg).toBe(false);
    }
  });

  it("⭐⭐ quem administra a organização vê o seletor mesmo com UM time", () => {
    // "Gerenciar a organização" só existe dentro do seletor.
    const umaRaiz = [TIMES[1], TIMES[2]];
    const escolha = contextChoice(umaRaiz, pessoa([SEO]), true);
    expect(escolha.kind).toBe("switcher");
    if (escolha.kind === "switcher") expect(escolha.canManageOrg).toBe(true);
  });

  it("sem time e sem poder: não mostra nada", () => {
    expect(contextChoice(TIMES, pessoa([]), false).kind).toBe("none");
  });
});

describe("peopleEntry", () => {
  it("um time: cai na tela dele", () => {
    expect(peopleEntry([TIMES[1]])).toEqual({ kind: "team", teamId: MKT });
  });

  it("nenhum time: não inventa destino", () => {
    expect(peopleEntry([])).toEqual({ kind: "none" });
  });
});

describe("currentContext — o botão diz ONDE VOCÊ ESTÁ", () => {
  const ORG = "UniFECAF";

  it("na tela do time: o nome do time", () => {
    expect(currentContext(`/times/${MKT}`, TIMES, ORG)).toEqual({
      label: "Marketing",
      activeRootId: MKT,
    });
  });

  it("⚠️ num SUBTIME: sobe e mostra o TIME RAIZ", () => {
    expect(currentContext(`/times/${SEO}`, TIMES, ORG)).toEqual({
      label: "Marketing",
      activeRootId: MKT,
    });
  });

  it("⚠️ num NETO: sobe os dois níveis", () => {
    expect(currentContext(`/times/${JR}`, TIMES, ORG).label).toBe("Marketing");
  });

  it("⚠️ no QUADRO do time: é o mesmo time", () => {
    expect(currentContext(`/quadro/${SEO}`, TIMES, ORG)).toEqual({
      label: "Marketing",
      activeRootId: MKT,
    });
  });

  it("na tela da organização: o NOME dela, e nenhum time marcado", () => {
    expect(currentContext("/organizacao", TIMES, ORG)).toEqual({
      label: ORG,
      activeRootId: null,
    });
  });

  it("⚠️⚠️ sem time na URL, mostra a organização (e não o que o botão faz)", () => {
    // Telas sem time na URL.
    for (const rota of [
      "/minhas-tarefas",
      "/projetos",
      "/solicitacoes",
      "/perfil",
      "/tarefa/abc",
      "/times",
      "/quadro",
      "/",
    ]) {
      expect(currentContext(rota, TIMES, ORG)).toEqual({
        label: ORG,
        activeRootId: null,
      });
    }
  });

  it("id desconhecido na URL não inventa nome", () => {
    expect(currentContext("/times/nao-existe", TIMES, ORG).label).toBe(ORG);
    expect(currentContext(`/times/${MKT}`, [], ORG).label).toBe(ORG);
  });

  it("sem o nome da organização, cai num rótulo em vez de vazio", () => {
    // Antes de `getWorkspace()` responder.
    expect(currentContext("/minhas-tarefas", TIMES, "").label).toBe(
      "Organização",
    );
    expect(currentContext("/minhas-tarefas", TIMES, "   ").label).toBe(
      "Organização",
    );
  });

  it("caminho com sufixo resolve o MESMO time", () => {
    expect(currentContext(`/times/${MKT}/`, TIMES, ORG).label).toBe("Marketing");
  });
});

describe("ownRootTeams — onde a pessoa TRABALHA", () => {
  it("⚠️⚠️ subconjunto de `rootsForPerson`, e a diferença importa", () => {
    // Quem administra a organização alcança todos os times e trabalha em um.
    const admin = pessoa([MKT]);
    expect(rootsForPerson(TIMES, admin, true).map((t) => t.name)).toEqual([
      "Marketing",
      "TI",
    ]);
    expect(ownRootTeams(TIMES, admin).map((t) => t.name)).toEqual(["Marketing"]);
  });

  it("⚠️ resolve o vínculo na ÁRVORE: quem está só no subtime trabalha no time", () => {
    expect(ownRootTeams(TIMES, pessoa([SEO])).map((t) => t.name)).toEqual([
      "Marketing",
    ]);
    expect(ownRootTeams(TIMES, pessoa([JR])).map((t) => t.name)).toEqual([
      "Marketing",
    ]);
  });

  it("⚠️ VAZIO é resposta válida", () => {
    // Papel de organização pode não ter vínculo; `preferredTeams` cai no alcance.
    expect(ownRootTeams(TIMES, pessoa([]))).toEqual([]);
  });

  it("sem usuário, vazio", () => {
    expect(ownRootTeams(TIMES, null)).toEqual([]);
  });

  it("ordenado por nome, como todo lugar que responde 'a primeira'", () => {
    expect(ownRootTeams(TIMES, pessoa([TI, SEO])).map((t) => t.name)).toEqual([
      "Marketing",
      "TI",
    ]);
  });
});

describe("switcherHref -- trocar de time preserva a tela", () => {
  const B = "time-b";

  it("nas cinco telas recortadas, fica na MESMA tela", () => {
    for (const tela of [
      "/minhas-tarefas",
      "/projetos",
      "/arquivadas",
      "/solicitacoes",
      "/formularios",
    ]) {
      expect(switcherHref(tela, "", B)).toBe(`${tela}?time=${B}`);
    }
  });

  it("⚠️ e PRESERVA os outros parâmetros da tela", () => {
    expect(switcherHref("/minhas-tarefas", "?ver=lista&time=time-a", B)).toBe(
      `/minhas-tarefas?ver=lista&time=${B}`,
    );
  });

  it("no quadro, vai para o QUADRO do outro time (caminho, não parâmetro)", () => {
    // O time está no caminho; `?time=` seria ignorado.
    expect(switcherHref("/quadro/time-a", "", B)).toBe(`/quadro/${B}`);
    expect(switcherHref("/quadro/time-a", "?quadro=xyz", B)).toBe(`/quadro/${B}`);
    // O endereço legado, sem time no caminho, também é quadro.
    expect(switcherHref("/quadro", "", B)).toBe(`/quadro/${B}`);
  });

  it("na organização, vai para a tela do time", () => {
    expect(switcherHref("/organizacao", "", B)).toBe(`/times/${B}`);
  });

  it("na tela de um time, troca o time da URL", () => {
    expect(switcherHref("/times/time-a", "", B)).toBe(`/times/${B}`);
    expect(switcherHref("/times/time-a", "?aba=inativos", B)).toBe(`/times/${B}`);
  });

  it("⚠️ numa tela que NÃO lê o parâmetro, não inventa `?time=`", () => {
    // Escrever o parâmetro aqui daria uma URL que diz o time e não filtra nada.
    expect(switcherHref("/tarefa/t-1", "", B)).toBe(`/times/${B}`);
    expect(switcherHref("/perfil", "", B)).toBe(`/times/${B}`);
  });
});

describe("peopleEntryFor -- o item Time segue o time ativo", () => {
  const MKT_T: Team = { id: "mkt", workspace_id: "ws", parent_team_id: null, name: "Marketing", slug: "mkt" };
  const COM_T: Team = { id: "com", workspace_id: "ws", parent_team_id: null, name: "Comercial", slug: "com" };
  // Preferidos: onde a pessoa trabalha (Marketing) primeiro.
  const PREFERIDOS = [MKT_T, COM_T];

  it("⚠️ com o Comercial ativo, leva ao Comercial -- e não ao primeiro preferido", () => {
    expect(
      peopleEntryFor({ kind: "team", teamId: "com", fromUrl: true }, PREFERIDOS),
    ).toEqual({ kind: "team", teamId: "com" });
  });

  it("sem time ativo resolvido (`null`), cai na regra de sempre", () => {
    expect(peopleEntryFor(null, PREFERIDOS)).toEqual({ kind: "team", teamId: "mkt" });
  });

  it("\"Todos os times\" não é um time: regra de sempre", () => {
    expect(peopleEntryFor({ kind: "all" }, PREFERIDOS)).toEqual({ kind: "team", teamId: "mkt" });
  });

  it("sem time nenhum, continua sem entrada", () => {
    expect(peopleEntryFor({ kind: "none" }, [])).toEqual({ kind: "none" });
  });
});
