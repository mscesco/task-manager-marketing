/**
 * Spec 048, fatia A — em que time a tela está.
 *
 * ⚠️ POR QUE ESTES TESTES EXISTEM: nenhum erro aqui dá tela vermelha. Errar
 * **recorta a tela pelo time errado** — a pessoa vê o Comercial vazio achando
 * que está no Marketing, e os quatro portões passam verdes. É a mesma classe de
 * defeito que a §3 da spec mediu em seis lugares do produto.
 *
 * SABOTAGENS medidas -- ver o fim do arquivo.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_TEAMS,
  TEAM_PARAM,
  activeTeam,
  preferredTeams,
  teamUrlToWrite,
  withTeam,
} from "../activeTeam";
import { rootTeamOf } from "../areas";
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
    // O contexto é o TIME; subtime é navegação dentro dele. Mesma regra do
    // rótulo da barra (`currentContext`), e agora do recorte das telas.
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
    // ⚠️ `/times/<A>?time=<B>` é link malformado. Honrar o parâmetro mostraria
    // o time A com a barra dizendo B -- a tela e o contexto discordando na
    // mesma página.
    expect(
      activeTeam(`/times/${MKT}`, `?${TEAM_PARAM}=${COM}`, TIMES, AMBOS, AMBOS),
    ).toMatchObject({ teamId: MKT });
  });

  it("⚠️ o caminho NÃO é validado contra o alcance", () => {
    // ⚠️ ASSIMETRIA DELIBERADA (ver o bloco de `activeTeam`): no caminho, quem
    // decide acesso é a tela e, atrás dela, o servidor. Um operador do
    // Marketing que cole a URL do Comercial tem de ver a recusa vinda de lá --
    // e não um recorte silencioso para o time dele, que esconderia o 403.
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
    // Árvore ainda carregando, ou id colado à mão.
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
    // A tela do time guarda `?ver=` e `?aba=` na URL (Spec 047). Ler o time não
    // pode depender de ele ser o primeiro nem o único.
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
    // ⚠️ A outra metade da assimetria: o parâmetro é um FILTRO que o próprio
    // produto escreve. Um id que a pessoa não alcança só chega ali por link
    // velho, e a resposta certa para link velho é cair no time dela e
    // reescrever a URL -- não desenhar uma tela vazia sem explicação.
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
  it("⚠️⚠️ PREFERE O TIME EM QUE A PESSOA TRABALHA — o defeito da §4.5", () => {
    // ⚠️⚠️ ESTE É O TESTE QUE CORRIGE A PRÓPRIA SPEC. A §4.5 dizia "o time da
    // pessoa, a mesma conta de `peopleEntry`" -- e `peopleEntry` recebe
    // `rootsForPerson`, que para quem tem papel de organização devolve TODOS os
    // times. Para a conta dela (ADMIN) o primeiro por nome é "Comercial", e ela
    // trabalha no Marketing.
    //
    // Alcança os dois, trabalha num: a reserva é o que ela trabalha.
    expect(activeTeam("/minhas-tarefas", "", TIMES, AMBOS, SO_MKT)).toEqual({
      kind: "team",
      teamId: MKT,
      fromUrl: false,
    });
  });

  it("sem vínculo nenhum, cai no primeiro que ela ALCANÇA", () => {
    // ⚠️ É o cadastro de quem administra a organização desde 08/09: papel de
    // organização sem vínculo de time (Spec 045, fatia B). Aí sim vale "o
    // primeiro por nome".
    expect(activeTeam("/minhas-tarefas", "", TIMES, AMBOS, [])).toEqual({
      kind: "team",
      teamId: COM,
      fromUrl: false,
    });
  });

  it("⚠️ `fromUrl: false` na reserva — é ele que manda reescrever a URL", () => {
    // Sem isso o link copiado não carrega o contexto, e o Voltar volta para um
    // estado sem time. É o defeito silencioso desta fatia.
    const r = activeTeam("/projetos", "", TIMES, SO_MKT, SO_MKT);
    expect(r).toMatchObject({ fromUrl: false });
  });

  it("sem alcance nenhum, não inventa time", () => {
    expect(activeTeam("/minhas-tarefas", "", TIMES, [], [])).toEqual({
      kind: "none",
    });
  });

  it("⚠️ sem alcance, nem o caminho é inventado — mas o do caminho vale", () => {
    // Quem não alcança nada ainda pode abrir `/times/<id>` por link; a recusa
    // vem da tela.
    expect(activeTeam(`/times/${MKT}`, "", TIMES, [], [])).toMatchObject({
      teamId: MKT,
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
    // Trocar de time não pode apagar o recorte que a pessoa escolheu -- ela
    // perderia a aba de inativos por ter trocado de time.
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

describe("rootTeamOf — a cópia que virou uma", () => {
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
    // ⚠️ É AQUI QUE AS DUAS CÓPIAS DIVERGIAM. A de `lens.ts` fazia `break` e
    // devolvia o último nó conhecido -- afirmando que um SUBTIME era raiz. A
    // unificação escolheu `null`, que é fail-closed: "não sei" faz o chamador
    // cair na reserva, enquanto o último-nó-conhecido escreve um time errado
    // como se fosse certo, e recorta a tela por ele.
    const orfao = [time("t-orfao", "Órfão", "t-pai-que-nao-veio")];
    expect(rootTeamOf("t-orfao", orfao)).toBeNull();
  });

  it("ciclo não trava a aba", () => {
    // `parent_team_id` apontando para um descendente giraria para sempre sem o
    // teto de saltos.
    //
    // ⚠️ O TESTE AFIRMA QUE ELA TERMINA, e não em qual nó ela para. A primeira
    // versão deste teste esperava `"b"` e ficou vermelha: num ciclo de dois, o
    // nó final é função da PARIDADE do teto de saltos (50, par, devolve o nó
    // inicial). Amarrar isso transformaria `MAX_SALTOS` em contrato — mudar 50
    // para 51 quebraria um teste sem que nada de real mudasse.
    const ciclo = [time("a", "A", "b"), time("b", "B", "a")];
    const r = rootTeamOf("a", ciclo);
    expect(["a", "b"]).toContain(r);
  });
});

describe("preferredTeams", () => {
  it("⚠️⚠️ onde a pessoa TRABALHA primeiro, e o resto depois", () => {
    // ⚠️ A regra existe para não ser três cópias: a reserva do `activeTeam`, o
    // destino do item TIME e a entrada do quadro fazem a mesma pergunta.
    expect(preferredTeams(AMBOS, SO_MKT).map((t) => t.id)).toEqual([MKT, COM]);
  });

  it("sem vínculo, é a ordem do alcance", () => {
    // O cadastro de quem administra a organização desde 08/09.
    expect(preferredTeams(AMBOS, []).map((t) => t.id)).toEqual([COM, MKT]);
  });

  it("⚠️ NÃO DESCARTA o resto -- é ele que distingue 'uma só' de 'várias'", () => {
    // `entradaDoQuadro` desenha com uma e redireciona com várias. Se esta
    // função devolvesse só `own`, quem alcança dois times e trabalha num
    // pareceria ter um -- e a entrada deixaria de redirecionar.
    expect(preferredTeams(AMBOS, SO_MKT)).toHaveLength(2);
  });

  it("não duplica quem está nas duas listas", () => {
    expect(preferredTeams(AMBOS, AMBOS).map((t) => t.id)).toEqual([COM, MKT]);
  });
});

// SABOTAGENS medidas:
//   A. Honrar o parâmetro antes do caminho. **Cai 1** -- o teste ⭐ do caminho
//      ganhando, e na tela seria a barra dizendo um time e o conteúdo sendo de
//      outro.
//   B. Validar o CAMINHO contra `reachable`. **Cai 1**: o operador que cola a
//      URL de outro time deixa de ver o 403 e passa a ver o time dele, o que
//      esconde a recusa em vez de mostrá-la.
//   C. NÃO validar o PARÂMETRO contra `reachable`. **Cai 1**: link velho passa
//      a desenhar tela vazia sem explicação.
//   D. Devolver `fromUrl: true` na reserva. **Cai 2**: a URL nunca é reescrita,
//      e o link copiado não carrega o contexto -- o defeito silencioso desta
//      fatia.
//   E. Trocar o `params.set` por concatenação de string em `withTeam`.
//      **Cai 2**: o time duplica na URL e os outros parâmetros somem.

// ⚠️ A §4.1 da spec: sem a reescrita, o recorte existe e é invisível -- copiar
// o link manda outra pessoa para o time DELA.
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
    // O caso que estragaria link colado: na primeira renderização o
    // `TeamParamReader` ainda não reportou, `activeTeam` cai na reserva, e
    // escrever aqui sobrescreveria o `?time=` que estava na URL antes de
    // alguém tê-lo lido.
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
    // Escrever em `/quadro/<id>` ou `/organizacao` produziria a URL que mente
    // -- e em `/quadro/<id>` o `activeTeam` ignora o parâmetro de propósito.
    for (const tela of ["/quadro/raiz-a", "/organizacao", "/times/raiz-a", "/tarefa/t1"]) {
      expect(
        teamUrlToWrite(tela, { kind: "team", teamId: RAIZ_A, fromUrl: false }, ""),
      ).toBe(null);
    }
  });
});
