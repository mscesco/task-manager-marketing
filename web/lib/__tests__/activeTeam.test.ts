// Em que time a tela está: erro aqui recorta a tela pelo time errado sem dar tela vermelha.

import { describe, it, expect } from "vitest";
import {
  ALL_TEAMS,
  TEAM_PARAM,
  activeTeam,
  navHref,
  preferredTeams,
  publishedActiveTeam,
  teamUrlToWrite,
  withTeam,
} from "../activeTeam";
import { rootTeamOf } from "../rootTeams";
import type { Team } from "../api";

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const COM = "t-com";

function time(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  time(COM, "Comercial", null),
  time(MKT, "Marketing", null),
  time(SEO, "SEO", MKT),
  time(JR, "SEO Junior", SEO),
];

/** `rootsForPerson` devolve ordenado por nome -- Comercial antes de Marketing. */
const AMBOS: Team[] = [TIMES[0], TIMES[1]];
const SO_MKT: Team[] = [TIMES[1]];

describe("activeTeam — o caminho", () => {
  it("na tela do time, é o time do caminho", () => {
    expect(activeTeam(`/times/${MKT}`, "", TIMES, AMBOS, AMBOS)).toEqual({
      kind: "team",
      teamId: MKT,
      fromUrl: true,
    });
  });

  it("⚠️ num SUBTIME, sobe até a raiz", () => {
    expect(activeTeam(`/times/${SEO}`, "", TIMES, AMBOS, AMBOS)).toMatchObject({
      teamId: MKT,
    });
    expect(activeTeam(`/times/${JR}`, "", TIMES, AMBOS, AMBOS)).toMatchObject({
      teamId: MKT,
    });
  });

  it("no quadro, também", () => {
    expect(activeTeam(`/quadro/${SEO}`, "", TIMES, AMBOS, AMBOS)).toMatchObject({
      teamId: MKT,
      fromUrl: true,
    });
  });

  it("⚠️⚠️ o CAMINHO ganha do parâmetro", () => {
    expect(
      activeTeam(`/times/${MKT}`, `?${TEAM_PARAM}=${COM}`, TIMES, AMBOS, AMBOS),
    ).toMatchObject({ teamId: MKT });
  });

  it("⚠️ o caminho NÃO é validado contra o alcance", () => {
    // Quem decide acesso no caminho é a tela e o servidor (o 403 tem de aparecer).
    expect(activeTeam(`/times/${COM}`, "", TIMES, SO_MKT, SO_MKT)).toMatchObject({
      teamId: COM,
      fromUrl: true,
    });
  });

  it("caminho com sufixo resolve o MESMO time", () => {
    expect(activeTeam(`/times/${MKT}/`, "", TIMES, AMBOS, AMBOS)).toMatchObject({
      teamId: MKT,
    });
  });

  it("id desconhecido no caminho cai na reserva", () => {
    expect(activeTeam("/times/nao-existe", "", TIMES, SO_MKT, SO_MKT)).toEqual({
      kind: "team",
      teamId: MKT,
      fromUrl: false,
    });
  });
});

describe("activeTeam — o parâmetro", () => {
  it("lê o time do parâmetro", () => {
    expect(
      activeTeam("/minhas-tarefas", `?${TEAM_PARAM}=${MKT}`, TIMES, AMBOS, AMBOS),
    ).toEqual({ kind: "team", teamId: MKT, fromUrl: true });
  });

  it("aceita a query com e sem `?`", () => {
    const comInterrogacao = activeTeam(
      "/projetos",
      `?${TEAM_PARAM}=${COM}`,
      TIMES,
      AMBOS,
      AMBOS,
    );
    const sem = activeTeam("/projetos", `${TEAM_PARAM}=${COM}`, TIMES, AMBOS, AMBOS);
    expect(sem).toEqual(comInterrogacao);
  });

  it("⚠️ convive com outros parâmetros", () => {
    expect(
      activeTeam(
        "/minhas-tarefas",
        `?aba=inativos&${TEAM_PARAM}=${COM}&ver=subtimes`,
        TIMES,
        AMBOS,
        AMBOS,
      ),
    ).toMatchObject({ teamId: COM, fromUrl: true });
  });

  it("`tudo` é um valor, e não um time", () => {
    expect(
      activeTeam("/minhas-tarefas", `?${TEAM_PARAM}=${ALL_TEAMS}`, TIMES, AMBOS, AMBOS),
    ).toEqual({ kind: "all" });
  });

  it("⚠️⚠️ parâmetro FORA DO ALCANCE cai no time da pessoa, e pede reescrita", () => {
    // O parâmetro é filtro escrito pelo produto: link velho cai no time da pessoa.
    expect(
      activeTeam("/minhas-tarefas", `?${TEAM_PARAM}=${COM}`, TIMES, SO_MKT, SO_MKT),
    ).toEqual({ kind: "team", teamId: MKT, fromUrl: false });
  });

  it("parâmetro vazio é como ausente", () => {
    expect(
      activeTeam("/projetos", `?${TEAM_PARAM}=`, TIMES, SO_MKT, SO_MKT),
    ).toMatchObject({ teamId: MKT, fromUrl: false });
  });
});

describe("activeTeam — a reserva", () => {
  it("⚠️⚠️ PREFERE O TIME EM QUE A PESSOA TRABALHA", () => {
    // Alcança os dois, trabalha num: a reserva é o que ela trabalha.
    expect(activeTeam("/minhas-tarefas", "", TIMES, AMBOS, SO_MKT)).toEqual({
      kind: "team",
      teamId: MKT,
      fromUrl: false,
    });
  });

  it("sem vínculo nenhum, cai no primeiro que ela ALCANÇA", () => {
    // Papel de organização sem vínculo de time.
    expect(activeTeam("/minhas-tarefas", "", TIMES, AMBOS, [])).toEqual({
      kind: "team",
      teamId: COM,
      fromUrl: false,
    });
  });

  it("sem alcance nenhum, não inventa time", () => {
    expect(activeTeam("/minhas-tarefas", "", TIMES, [], [])).toEqual({
      kind: "none",
    });
  });
});

describe("withTeam", () => {
  it("põe o time na URL", () => {
    expect(withTeam("/minhas-tarefas", "", MKT)).toBe(
      `/minhas-tarefas?${TEAM_PARAM}=${MKT}`,
    );
  });

  it("⚠️ PRESERVA os outros parâmetros", () => {
    const url = withTeam("/times/x", "?ver=subtimes&aba=inativos", MKT);
    expect(url).toContain("ver=subtimes");
    expect(url).toContain("aba=inativos");
    expect(url).toContain(`${TEAM_PARAM}=${MKT}`);
  });

  it("substitui o time que já estava lá, sem duplicar", () => {
    const url = withTeam("/projetos", `?${TEAM_PARAM}=${COM}`, MKT);
    expect(url).toBe(`/projetos?${TEAM_PARAM}=${MKT}`);
  });

  it("`tudo` também é um valor válido", () => {
    expect(withTeam("/minhas-tarefas", "", ALL_TEAMS)).toBe(
      `/minhas-tarefas?${TEAM_PARAM}=${ALL_TEAMS}`,
    );
  });
});

describe("rootTeamOf", () => {
  it("de um subtime, devolve a raiz", () => {
    expect(rootTeamOf(SEO, TIMES)).toBe(MKT);
    expect(rootTeamOf(JR, TIMES)).toBe(MKT);
  });

  it("de uma raiz, devolve ela mesma", () => {
    expect(rootTeamOf(MKT, TIMES)).toBe(MKT);
  });

  it("id desconhecido devolve null", () => {
    expect(rootTeamOf("nao-existe", TIMES)).toBeNull();
  });

  it("⚠️⚠️ PAI PENDURADO devolve null, e NÃO o último nó conhecido", () => {
    // `null` é fail-closed: o chamador cai na reserva em vez de recortar por um subtime.
    const orfao = [time("t-orfao", "Órfão", "t-pai-que-nao-veio")];
    expect(rootTeamOf("t-orfao", orfao)).toBeNull();
  });

  it("ciclo não trava a aba", () => {
    // Afirma só que termina: o nó final depende da paridade de `MAX_SALTOS`.
    const ciclo = [time("a", "A", "b"), time("b", "B", "a")];
    const r = rootTeamOf("a", ciclo);
    expect(["a", "b"]).toContain(r);
  });
});

describe("preferredTeams", () => {
  it("⚠️⚠️ onde a pessoa TRABALHA primeiro, e o resto depois", () => {
    expect(preferredTeams(AMBOS, SO_MKT).map((t) => t.id)).toEqual([MKT, COM]);
  });

  it("sem vínculo, é a ordem do alcance", () => {
    expect(preferredTeams(AMBOS, []).map((t) => t.id)).toEqual([COM, MKT]);
  });

  it("não duplica quem está nas duas listas", () => {
    expect(preferredTeams(AMBOS, AMBOS).map((t) => t.id)).toEqual([COM, MKT]);
  });
});

describe("teamUrlToWrite", () => {
  const RAIZ_A = "raiz-a";

  it("na tela recortada, com time INFERIDO, escreve", () => {
    expect(
      teamUrlToWrite("/minhas-tarefas", { kind: "team", teamId: RAIZ_A, fromUrl: false }, ""),
    ).toBe(`/minhas-tarefas?time=${RAIZ_A}`);
  });

  it("⚠️ preserva os outros parâmetros que já estavam lá", () => {
    expect(
      teamUrlToWrite(
        "/minhas-tarefas",
        { kind: "team", teamId: RAIZ_A, fromUrl: false },
        "?ver=lista",
      ),
    ).toBe(`/minhas-tarefas?ver=lista&time=${RAIZ_A}`);
  });

  it("⚠️⚠️ com a query AINDA NÃO LIDA (`null`), NÃO escreve", () => {
    // Sem a query lida, escrever sobrescreveria o `?time=` colado.
    expect(
      teamUrlToWrite("/minhas-tarefas", { kind: "team", teamId: RAIZ_A, fromUrl: false }, null),
    ).toBe(null);
  });

  it("quando a URL JÁ disse, não escreve (senão é laço)", () => {
    expect(
      teamUrlToWrite(
        "/minhas-tarefas",
        { kind: "team", teamId: RAIZ_A, fromUrl: true },
        `?time=${RAIZ_A}`,
      ),
    ).toBe(null);
  });

  it("`tudo` e `nenhum` não escrevem", () => {
    expect(teamUrlToWrite("/minhas-tarefas", { kind: "all" }, "?time=tudo")).toBe(null);
    expect(teamUrlToWrite("/minhas-tarefas", { kind: "none" }, "")).toBe(null);
  });

  it("⚠️ numa tela que NÃO carrega o parâmetro, nunca escreve", () => {
    for (const tela of ["/quadro/raiz-a", "/organizacao", "/times/raiz-a", "/tarefa/t1"]) {
      expect(
        teamUrlToWrite(tela, { kind: "team", teamId: RAIZ_A, fromUrl: false }, ""),
      ).toBe(null);
    }
  });
});

describe("publishedActiveTeam -- a barra só publica o que já sabe", () => {
  const COMERCIAL: ActiveTeamForTest = { kind: "team", teamId: "com", fromUrl: true };
  const NENHUM: ActiveTeamForTest = { kind: "none" };

  it("⚠️ árvore de times AINDA a caminho -> null, e não `kind: \"none\"`", () => {
    expect(publishedActiveTeam(NENHUM, false, "?time=com")).toBe(null);
  });

  it("⚠️ query AINDA não lida -> null, e não o time de reserva", () => {
    const reserva: ActiveTeamForTest = { kind: "team", teamId: "mkt", fromUrl: false };
    expect(publishedActiveTeam(reserva, true, null)).toBe(null);
  });

  it("as duas respondidas -> publica", () => {
    expect(publishedActiveTeam(COMERCIAL, true, "?time=com")).toBe(COMERCIAL);
  });

  it("⚠️ árvore que FALHOU conta como respondida -- `none` sai, e a tela não trava", () => {
    // O `catch` de `listTeamsAll()` no `AppShell` é silencioso; sem isto a tela trava.
    expect(publishedActiveTeam(NENHUM, true, "")).toBe(NENHUM);
  });
});

type ActiveTeamForTest = Parameters<typeof publishedActiveTeam>[0];

describe("navHref -- o menu leva o time junto", () => {
  const COMERCIAL: ActiveTeamForTest = { kind: "team", teamId: "com", fromUrl: true };

  it("⚠️ tela recortada recebe o time ativo", () => {
    expect(navHref("/projetos", COMERCIAL)).toBe("/projetos?time=com");
    expect(navHref("/arquivadas", COMERCIAL)).toBe("/arquivadas?time=com");
  });

  it("⚠️ \"Todos os times\" NÃO é levado para as outras telas", () => {
    expect(navHref("/projetos", { kind: "all" })).toBe("/projetos");
  });

  it("⚠️ barra ainda sem resposta (`null`) dá o caminho puro, e não um palpite", () => {
    expect(navHref("/projetos", null)).toBe("/projetos");
  });

  it("tela que não lê o parâmetro não o recebe", () => {
    expect(navHref("/organizacao", COMERCIAL)).toBe("/organizacao");
    expect(navHref("/perfil", COMERCIAL)).toBe("/perfil");
  });
});

describe("activeTeam -- parâmetro com SUBTIME sobe até a raiz", () => {
  it("⚠️ `?time=<subtime>` resolve para a raiz dele", () => {
    expect(
      activeTeam("/projetos", `?${TEAM_PARAM}=${SEO}`, TIMES, AMBOS, SO_MKT),
    ).toMatchObject({ kind: "team", teamId: MKT });
  });

  it("⚠️ e pede reescrita da URL para a raiz (`fromUrl: false`)", () => {
    expect(
      activeTeam("/projetos", `?${TEAM_PARAM}=${JR}`, TIMES, AMBOS, SO_MKT),
    ).toEqual({ kind: "team", teamId: MKT, fromUrl: false });
  });

  it("subtime de raiz FORA do alcance continua caindo na reserva", () => {
    const soComercial: Team[] = [TIMES[0]];
    expect(
      activeTeam("/projetos", `?${TEAM_PARAM}=${SEO}`, TIMES, soComercial, soComercial),
    ).toEqual({ kind: "team", teamId: COM, fromUrl: false });
  });
});
