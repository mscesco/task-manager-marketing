// =====================================================
// lib/__tests__/quadros.test.ts -- `listBoards` e `colunasDoQuadroGeral`
// -----------------------------------------------------
// Spec 036, fatia 4b. As duas funcoes que trazem as colunas da API para o
// front, e que substituem a const `STATUSES` a partir daqui.
//
// ⚠️ POR QUE `colunasDoQuadroGeral` MERECE TESTE E `listBoards` QUASE NAO.
// A segunda e um `fetch` e nada mais -- o unico caso que vale afirmar dela e
// que ela bate na URL certa, porque errar a URL devolve 404 e a tela mostraria
// "sem colunas", que e um estado plausivel e silencioso. A primeira tem regra:
// achar o quadro padrao, ordenar por `position`, e devolver `[]` em vez de
// levantar quando nao acha.
//
// ⚠️ O `[]` NAO E DETALHE. Quem chama distingue "ainda carregando" (`null` no
// estado) de "carregou e nao ha coluna" (`[]`), e a tela precisa desenhar o
// segundo -- a sabotagem da fatia 4 no `plan.md` e literalmente "devolver a
// lista de colunas vazia da API". Se esta funcao levantasse, a tela cairia no
// caminho de erro em vez do de lista vazia, e a sabotagem provaria a coisa
// errada.
//
// ⚠️ SEM MEMOIZACAO E AFIRMADO AQUI, de proposito. `listTeams` e memoizada e a
// Spec 029 pagou o preco disso (criar subtime nao aparecia ate recarregar).
// O teste `duas chamadas batem duas vezes` e o que impede alguem de
// "otimizar" isso de volta antes da fatia 5 trazer o CRUD de quadro.
//
// ⚠️ `colunasDoQuadroGeral` DELEGA PARA `quadroGeralComIndice` DESDE A 5b-5b.
// A regra ("achar o padrao pela flag, ordenar por position") mora la agora, e
// os testes dela abaixo continuam sendo os guardioes dessa regra -- so que por
// um degrau de indirecao. Se um deles ficar vermelho, olhe
// `quadroGeralComIndice` primeiro.
//
// SABOTAGENS (executar antes de commitar):
//   1. Em `lib/api.ts`, dentro de `quadroGeralComIndice`, trocar
//          const geral = quadros.find((q) => q.is_default);
//      por
//          const geral = quadros.find((q) => q.name === "Quadro geral");
//      -- ou seja, o criterio por NOME em vez da flag. Nome e editavel desde a
//      fatia 5b-3; a flag tem indice parcial no banco.
//      Deve cair `acha o quadro padrao pela FLAG, nao pelo nome`.
//   2. Na mesma funcao, trocar
//          return { colunas, indice: indiceDeColunas(quadros, geral?.id ?? null) };
//      por
//          return { colunas, indice: indiceDeColunas(geral ? [geral] : [], geral?.id ?? null) };
//      -- ou seja, indexar SO o quadro padrao, que e o comportamento que esta
//      fatia existe para acabar. Deve cair
//      `⚠️ o indice cobre o quadro AVULSO, que era o que se perdia antes` e
//      `⚠️ sem quadro padrao: colunas [] e o indice AINDA cheio`.
// =====================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTokens,
  apagarColuna,
  colunaComContagem,
  colunasDoQuadroGeral,
  createBoard,
  criarColuna,
  quadroGeralComIndice,
  renameBoard,
  renomearColuna,
  listBoards,
  setTokens,
  type Quadro,
} from "@/lib/api";
import type { Coluna } from "@/lib/coluna";

/** Responde SEMPRE com o corpo dado, em 200. Devolve o spy. */
function mockFetch(corpo: unknown) {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function col(
  id: string,
  name: string,
  position: number,
  over: Partial<Coluna> = {}
): Coluna {
  return {
    id,
    name,
    color: "var(--status-backlog-dot)",
    position,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: false,
    ...over,
  };
}

function quadro(over: Partial<Quadro> & { id: string; name: string }): Quadro {
  return {
    team_id: "team-marketing",
    is_default: false,
    colunas: [],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  setTokens("access-de-teste", "refresh-de-teste");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokens();
  localStorage.clear();
});

describe("listBoards", () => {
  it("bate em /api/v1/boards", async () => {
    // ⚠️ Errar a URL devolve 404, a tela mostra "sem colunas", e isso e um
    // estado plausivel -- ninguem desconfia. E o unico caso desta funcao que
    // vale afirmar.
    const spy = mockFetch([]);

    await listBoards();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/api/v1/boards");
  });

  it("devolve os quadros como vieram, sem filtrar nada", async () => {
    // A lente e do BACKEND (ADR 0035, D3). Se um dia esta funcao filtrar
    // alguma coisa, sera uma segunda trava de visibilidade no cliente -- que
    // e a coisa que a 0030 e a 0035 recusaram duas vezes.
    mockFetch([
      quadro({ id: "b-geral", name: "Quadro geral", is_default: true }),
      quadro({ id: "b-seo", name: "Interno SEO", team_id: "team-seo" }),
    ]);

    const r = await listBoards();

    expect(r.map((q) => q.id)).toEqual(["b-geral", "b-seo"]);
  });

  it("⚠️ NAO memoiza -- duas chamadas batem duas vezes", async () => {
    // Ver o cabecalho. `listTeams` memoiza e a Spec 029 pagou por isso.
    const spy = mockFetch([]);

    await listBoards();
    await listBoards();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("colunasDoQuadroGeral", () => {
  it("acha o quadro padrao pela FLAG, nao pelo nome", async () => {
    // ⚠️ E O TESTE QUE A SABOTAGEM DERRUBA. O nome do quadro e editavel na
    // fatia 5; `is_default` tem indice parcial no banco
    // (`board_um_padrao_por_time`). Escolher pelo nome funciona hoje e quebra
    // no dia em que alguem renomear "Quadro geral" para "Marketing".
    mockFetch([
      quadro({ id: "b-seo", name: "Quadro geral", team_id: "team-seo" }),
      quadro({
        id: "b-real",
        name: "Marketing renomeado",
        is_default: true,
        colunas: [col("c-1", "Backlog", 0)],
      }),
    ]);

    const colunas = await colunasDoQuadroGeral();

    expect(colunas.map((c) => c.id)).toEqual(["c-1"]);
  });

  it("ordena por position, nao pela ordem que a API mandou", async () => {
    // ⚠️ O backend ja devolve ordenado, e por isso mesmo este teste existe:
    // uma dependencia na ordem de chegada passa despercebida ate o dia em que
    // a fatia 5 permitir reordenar coluna e o `position` deixar de coincidir
    // com a ordem de insercao.
    mockFetch([
      quadro({
        id: "b-geral",
        name: "Quadro geral",
        is_default: true,
        colunas: [
          col("c-3", "Concluído", 2),
          col("c-1", "Backlog", 0),
          col("c-2", "Em Andamento", 1),
        ],
      }),
    ]);

    const colunas = await colunasDoQuadroGeral();

    expect(colunas.map((c) => c.name)).toEqual([
      "Backlog",
      "Em Andamento",
      "Concluído",
    ]);
  });

  it("devolve [] quando nao ha quadro padrao -- e NAO levanta", async () => {
    // ⚠️ Ver o cabecalho: `[]` e "carregou e nao ha coluna", que a tela tem de
    // desenhar. Levantar mandaria a tela para o caminho de erro e a sabotagem
    // da fatia 4 provaria outra coisa.
    mockFetch([quadro({ id: "b-seo", name: "Interno SEO", team_id: "t-seo" })]);

    await expect(colunasDoQuadroGeral()).resolves.toEqual([]);
  });

  it("devolve [] quando a API nao devolve quadro nenhum", async () => {
    mockFetch([]);

    await expect(colunasDoQuadroGeral()).resolves.toEqual([]);
  });

  it("preserva semantic e notify_deadline de cada coluna", async () => {
    // ⚠️ Sem isto, as regras da fatia 4a (`avisaPrazo`, `pararEhNoticia`) leem
    // `undefined` e respondem errado em SILENCIO -- `undefined` nao e
    // "IN_PROGRESS" e nao e `true`, entao tudo vira "sem alerta, sem selo".
    // Nenhum portao pega: o tipo diz que os campos existem.
    mockFetch([
      quadro({
        id: "b-geral",
        name: "Quadro geral",
        is_default: true,
        colunas: [
          col("c-bloq", "Bloqueado", 0, {
            semantic: "IN_PROGRESS",
            notify_deadline: false,
          }),
        ],
      }),
    ]);

    const [bloqueado] = await colunasDoQuadroGeral();

    expect(bloqueado.semantic).toBe("IN_PROGRESS");
    expect(bloqueado.notify_deadline).toBe(false);
  });
});

describe("quadroGeralComIndice", () => {
  /** Um geral padrao + um avulso, que e o cenario da 5b-6 em diante. */
  function doisQuadros() {
    return [
      quadro({
        id: "b-geral",
        name: "Quadro geral",
        is_default: true,
        colunas: [col("g-and", "Em Andamento", 1), col("g-back", "Backlog", 0)],
      }),
      quadro({
        id: "b-campanhas",
        name: "Campanhas",
        colunas: [col("c-rev", "Em Revisão", 0)],
      }),
    ];
  }

  it("⚠️ UMA requisicao so -- colunas e indice saem da mesma resposta", async () => {
    // ⚠️ O PONTO DA FATIA. `listBoards` nao e memoizada (teste acima), entao
    // pedir as colunas numa chamada e o indice em outra sao DUAS viagens por
    // tela. Se alguem partir esta funcao em duas depois, e este numero que
    // muda.
    const spy = mockFetch(doisQuadros());

    await quadroGeralComIndice();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("devolve as colunas do padrao, ordenadas por position", async () => {
    mockFetch(doisQuadros());

    const { colunas } = await quadroGeralComIndice();

    expect(colunas.map((c) => c.id)).toEqual(["g-back", "g-and"]);
  });

  it("⚠️ o indice cobre o quadro AVULSO, que era o que se perdia antes", async () => {
    // Antes da 5b-5b esta funcao descartava todo quadro que nao fosse o
    // padrao. A tarefa que vivesse em `b-campanhas` chegava na tela sem nome
    // de coluna, e o rotulo caia na reserva por status -- sem erro nenhum.
    mockFetch(doisQuadros());

    const { indice } = await quadroGeralComIndice();

    expect(indice.get("c-rev")?.coluna.name).toBe("Em Revisão");
    expect(indice.get("c-rev")?.nomeDoQuadro).toBe("Campanhas");
  });

  it("coluna do proprio geral vem com nomeDoQuadro null", async () => {
    mockFetch(doisQuadros());

    const { indice } = await quadroGeralComIndice();

    expect(indice.get("g-and")?.nomeDoQuadro).toBeNull();
  });

  it("⚠️ sem quadro padrao: colunas [] e o indice AINDA cheio", async () => {
    // Os dois lados importam. `[]` e o estado que a tela desenha de proposito
    // (mesma razao de `colunasDoQuadroGeral`); o indice cheio e o que impede
    // que a ausencia do padrao apague a tag de todo mundo.
    mockFetch([
      quadro({
        id: "b-campanhas",
        name: "Campanhas",
        colunas: [col("c-rev", "Em Revisão", 0)],
      }),
    ]);

    const { colunas, indice } = await quadroGeralComIndice();

    expect(colunas).toEqual([]);
    expect(indice.get("c-rev")?.nomeDoQuadro).toBe("Campanhas");
  });
});

// =====================================================================
// FATIA 5b-6 -- as funcoes de ESCRITA de quadro e de coluna.
//
// ⚠️ O QUE ESTES TESTES PRENDEM E A URL E O CORPO, e nao a regra -- a regra
// mora no backend e ja tem 751 testes contra Postgres de verdade. Aqui o modo
// de falha e outro: URL errada devolve 404 e a tela mostra "algo deu errado";
// campo a mais no corpo NAO da erro nenhum, porque o Pydantic do backend
// descarta chave desconhecida em silencio. Os dois passam despercebidos.
//
// ⚠️ A ROTA DE COLUNA E ANINHADA, E ISSO E TRAVA. A autorizacao no backend
// acontece sobre o TIME DO QUADRO, e o servico confere que a coluna pertence
// AQUELE quadro (`_coluna_do_quadro`, com o `board_id` no WHERE). Uma URL
// montada sem o `board_id` nao editaria coluna alheia -- devolveria 404 --,
// mas a tela nunca funcionaria e ninguem saberia por que.
//
// SABOTAGENS (medidas):
//   J. Em `apagarColuna`, mandar `destino_id` no CORPO em vez da query.
//   K. Em `criarColuna`, tirar o `boardId` da URL (`/api/v1/columns`).
//   L. Em `renameBoard`, mandar `{ name, team_id }` no corpo.
// =====================================================================
describe("escrita de quadro e de coluna (fatia 5b-6)", () => {
  /** A URL e o init da unica chamada feita. */
  function chamada(spy: ReturnType<typeof mockFetch>) {
    const [url, init] = spy.mock.calls[0];
    return { url: String(url), init: init as RequestInit };
  }

  it("createBoard: POST em /boards com nome e time", async () => {
    const spy = mockFetch(quadro({ id: "b1", name: "Campanhas" }));

    await createBoard({ name: "Campanhas", team_id: "team-crm" });

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Campanhas",
      team_id: "team-crm",
    });
  });

  it("⚠️ renameBoard manda SO o nome -- team_id nao vai junto", async () => {
    // ⚠️ O Pydantic do backend IGNORA chave desconhecida em silencio. Mandar
    // `team_id` aqui nao daria erro nenhum: seria descartado, a tela acharia
    // que mudou o time do quadro, e a visibilidade continuaria a mesma. Este
    // teste e o unico lugar onde isso fica vermelho.
    const spy = mockFetch(quadro({ id: "b1", name: "Outro nome" }));

    await renameBoard("b1", "Outro nome");

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards/b1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Outro nome" });
  });

  it("⚠️ criarColuna usa a rota ANINHADA, com o board na URL", async () => {
    const spy = mockFetch(col("c-nova", "Em Revisão", 4));

    await criarColuna("b1", { name: "Em Revisão", semantic: "IN_PROGRESS" });

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards/b1/columns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Em Revisão",
      semantic: "IN_PROGRESS",
    });
  });

  it("renomearColuna leva board E coluna na URL, e so o nome no corpo", async () => {
    const spy = mockFetch(col("c1", "Fazendo", 1));

    await renomearColuna("b1", "c1", "Fazendo");

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards/b1/columns/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Fazendo" });
  });

  it("colunaComContagem devolve a coluna com task_count", async () => {
    mockFetch({ ...col("c1", "Em Andamento", 2), task_count: 12 });

    const detalhe = await colunaComContagem("b1", "c1");

    expect(detalhe.task_count).toBe(12);
    expect(detalhe.name).toBe("Em Andamento");
  });

  it("⚠️ apagarColuna manda o destino na QUERY STRING, nao no corpo", async () => {
    // ⚠️ `DELETE` com corpo e aceito pelo FastAPI e DESCARTADO por parte da
    // infraestrutura de rede. Quando o corpo se perde, o backend para de mover
    // tarefa e passa a recusar por falta de destino -- um 422 sem causa
    // aparente, que so aparece em producao e nunca em desenvolvimento.
    const spy = mockFetch({ movidas: 12 });

    const movidas = await apagarColuna("b1", "c1", "c2");

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards/b1/columns/c1");
    expect(url).toContain("destino_id=c2");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(movidas).toBe(12);
  });

  it("apagarColuna sem destino nao poe query string nenhuma", async () => {
    // Coluna vazia some sem perguntar (ADR 0042 D5). Mandar `destino_id=`
    // vazio faria o backend procurar uma coluna de id "" e devolver 404.
    const spy = mockFetch({ movidas: 0 });

    await apagarColuna("b1", "c1");

    expect(chamada(spy).url).not.toContain("destino_id");
  });
});
