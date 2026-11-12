/**
 * O corpo que sai no `PUT /boards/{id}/columns`. Mock do cliente HTTP esconde
 * campo que o cliente não repassa. O prefixo `tmp:` só existe aqui e no
 * `_PREFIXO_TMP` do backend; nada os amarra além deste teste.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aplicarLoteDeColunas } from "../api";

const RESPOSTA = { colunas: [], movidas: 0 };

function requisicao() {
  const chamada = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = chamada[1] as RequestInit;
  return { url: String(chamada[0]), init, corpo: JSON.parse(String(init.body)) };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => RESPOSTA,
      text: async () => JSON.stringify(RESPOSTA),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("aplicarLoteDeColunas: o corpo que realmente sai", () => {
  it("⚠️ manda as SEIS listas, com esses nomes", async () => {
    // O `toEqual` compara o corpo INTEIRO: campo novo no `LoteDeColunas` sem
    // linha no `aplicarLoteDeColunas` reprova aqui, em vez de ser descartado
    // em silencio.
    await aplicarLoteDeColunas("b1", {
      criar: [
        {
          tmp: "t1",
          name: "Entregue",
          semantic: "DONE",
          color: "var(--status-done-dot)",
          notify_deadline: false,
        },
      ],
      renomear: [{ id: "c1", name: "A fazer" }],
      avisos: [{ id: "c4", notify_deadline: false }],
      alvos: ["c3"],
      apagar: [{ id: "c2", destino: "tmp:t1" }],
      ordem: ["c1", "tmp:t1"],
    });
    expect(requisicao().corpo).toEqual({
      criar: [
        {
          tmp: "t1",
          name: "Entregue",
          semantic: "DONE",
          color: "var(--status-done-dot)",
          notify_deadline: false,
        },
      ],
      renomear: [{ id: "c1", name: "A fazer" }],
      avisos: [{ id: "c4", notify_deadline: false }],
      alvos: ["c3"],
      apagar: [{ id: "c2", destino: "tmp:t1" }],
      ordem: ["c1", "tmp:t1"],
    });
  });

  it("⚠️ coluna nova SEM cor nao manda a chave -- e nao manda null", async () => {
    // ⚠️ A DIFERENCA E REAL NO BACKEND. Chave ausente = "a rotacao decide", que
    // e o comportamento de sempre. `color: null` seria um valor, e cairia na
    // validacao por lista como cor invalida. Um `?? null` bem-intencionado em
    // qualquer ponto do caminho quebraria criar coluna sem escolher cor.
    await aplicarLoteDeColunas("b1", {
      criar: [{ tmp: "t1", name: "Ideias", semantic: "OPEN" }],
    });
    expect(requisicao().corpo.criar[0]).toEqual({
      tmp: "t1",
      name: "Ideias",
      semantic: "OPEN",
    });
  });

  it("⚠️ lista ausente vira [], e nao some do corpo", async () => {
    // O backend tem default para as quatro, entao omiti-las funcionaria. Mandar
    // `[]` explicito e o que faz o corpo dizer "nao mexi nisto" em vez de "nao
    // sei disto" -- e e o que torna o log do servidor legivel.
    await aplicarLoteDeColunas("b1", {});
    expect(requisicao().corpo).toEqual({
      criar: [],
      renomear: [],
      avisos: [],
      alvos: [],
      apagar: [],
      ordem: [],
    });
  });

  it("PUT na rota de colunas do quadro", async () => {
    // ⚠️ `PUT` E `POST` DIVIDEM ESTA URL, e nao colidem: o FastAPI casa por
    // metodo. Trocar para POST aqui criaria coluna em vez de aplicar o lote.
    await aplicarLoteDeColunas("board-1", {});
    const { url, init } = requisicao();
    expect(url).toContain("/api/v1/boards/board-1/columns");
    expect(init.method).toBe("PUT");
  });
});
