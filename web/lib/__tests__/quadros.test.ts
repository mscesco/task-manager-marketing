// `listBoards` e `quadroGeralComIndice`, mais a escrita de quadro e coluna.
// `[]` (carregou e não há coluna) é diferente de levantar: a tela desenha o
// primeiro e cai no caminho de erro com o segundo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTokens,
  colunaComContagem,
  createBoard,
  quadroGeralComIndice,
  renameBoard,
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
    is_status_bridge: false,
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
    // URL errada devolve 404 e a tela mostra "sem colunas", um estado plausível.
    const spy = mockFetch([]);

    await listBoards();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/api/v1/boards");
  });

  it("não memoiza: duas chamadas batem duas vezes", async () => {
    // Com memo, criar um quadro não apareceria até recarregar a página.
    const spy = mockFetch([]);

    await listBoards();
    await listBoards();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("quadroGeralComIndice", () => {
  /** Um geral padrão + um avulso. */
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

  it("uma requisição só: colunas e índice saem da mesma resposta", async () => {
    const spy = mockFetch(doisQuadros());

    await quadroGeralComIndice("team-marketing");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("devolve as colunas do padrão, ordenadas por position", async () => {
    mockFetch(doisQuadros());

    const { colunas } = await quadroGeralComIndice("team-marketing");

    expect(colunas.map((c) => c.id)).toEqual(["g-back", "g-and"]);
  });

  it("o índice cobre o quadro avulso", async () => {
    // Sem isso, a tarefa de quadro avulso chega à tela sem nome de coluna.
    mockFetch(doisQuadros());

    const { indice } = await quadroGeralComIndice("team-marketing");

    expect(indice.get("c-rev")?.coluna.name).toBe("Em Revisão");
    expect(indice.get("c-rev")?.nomeDoQuadro).toBe("Campanhas");
  });

  it("sem quadro padrão: colunas [] e o índice ainda cheio", async () => {
    mockFetch([
      quadro({
        id: "b-campanhas",
        name: "Campanhas",
        colunas: [col("c-rev", "Em Revisão", 0)],
      }),
    ]);

    const { colunas, indice } = await quadroGeralComIndice("team-marketing");

    expect(colunas).toEqual([]);
    expect(indice.get("c-rev")?.nomeDoQuadro).toBe("Campanhas");
  });

  it("a API sem quadro nenhum: colunas [], sem levantar", async () => {
    mockFetch([]);

    await expect(quadroGeralComIndice("team-marketing")).resolves.toMatchObject({ colunas: [] });
  });
});

// Campo a mais no corpo não dá erro: o Pydantic do backend descarta chave
// desconhecida em silêncio. Por isso estes testes prendem URL e corpo.
describe("escrita de quadro e de coluna", () => {
  /** A URL e o init da única chamada feita. */
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

  it("renameBoard manda só o nome: team_id não vai junto", async () => {
    const spy = mockFetch(quadro({ id: "b1", name: "Outro nome" }));

    await renameBoard("b1", "Outro nome");

    const { url, init } = chamada(spy);
    expect(url).toContain("/api/v1/boards/b1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Outro nome" });
  });

  it("colunaComContagem: GET na rota da coluna aninhada no quadro", async () => {
    // A rota é aninhada porque o backend autoriza pelo time do quadro.
    const spy = mockFetch({ ...col("c1", "Em Andamento", 2), task_count: 12 });

    await colunaComContagem("b1", "c1");

    const { url, init } = chamada(spy);
    expect(url).toMatch(/\/api\/v1\/boards\/b1\/columns\/c1$/);
    expect(init.method ?? "GET").toBe("GET");
  });
});

describe("quadroGeralComIndice com duas raízes: o padrão é por time", () => {
  const MKT = "team-marketing";
  const COM = "team-comercial";

  function doisGerais() {
    mockFetch([
      quadro({
        id: "b-com",
        name: "Quadro geral",
        team_id: COM,
        is_default: true,
        colunas: [col("c-com", "Prospecção", 0)],
      }),
      quadro({
        id: "b-mkt",
        name: "Quadro geral",
        team_id: MKT,
        is_default: true,
        colunas: [col("c-mkt", "Pauta", 0)],
      }),
    ]);
  }

  it("devolve as colunas do time pedido, e não a primeira que a API mandou", async () => {
    // O Comercial vem primeiro na resposta, de propósito.
    doisGerais();
    const { colunas } = await quadroGeralComIndice(MKT);
    expect(colunas.map((c) => c.name)).toEqual(["Pauta"]);
  });

  it("sem time (`null`) devolve vazio, e não um dos dois", async () => {
    doisGerais();
    const { colunas } = await quadroGeralComIndice(null);
    expect(colunas).toEqual([]);
  });

  it("mas o índice continua de todos os quadros, mesmo sem time", async () => {
    doisGerais();
    const { indice } = await quadroGeralComIndice(null);
    expect(indice.get("c-mkt")).toBeTruthy();
    expect(indice.get("c-com")).toBeTruthy();
  });
});
