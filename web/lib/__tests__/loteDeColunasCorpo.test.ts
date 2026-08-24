/**
 * O CORPO que sai no `PUT /boards/{id}/columns`.
 *
 * ⚠️ SUBSTITUI O `reordenarColunasCorpo.test.ts`, apagado junto com a funcao
 * que ele guardava. Quarto arquivo do genero, e o motivo continua sendo o
 * mesmo: **mock do cliente HTTP esconde campo que o cliente nao repassa.**
 * `duplicateTaskCorpo` (05/08) e `createTaskCorpo` (13/08) nasceram DEPOIS do
 * estrago -- este e o segundo escrito antes.
 *
 * ⚠️ E AQUI HA MAIS SUPERFICIE QUE NOS OUTROS TRES. Sao SEIS listas (a
 * quinta, `alvos`, entrou na fatia 12; a sexta, `avisos`, na Spec 039 F9) e um
 * prefixo de texto (`tmp:`) que so existe em dois lugares: este arquivo e o
 * `_PREFIXO_TMP` do backend. Nada os amarra alem deste teste.
 *
 * ⚠️ E ELE CAIU DE NOVO EM 22/08, com a F9 -- pela SEGUNDA vez fazendo o
 * trabalho dele. Vale registrar porque as tres fatias anteriores (F6-c, F7, F8)
 * passaram pelos quatro portoes sem derrubar nada: quando existe um guardiao
 * de corpo, campo novo nao entra em silencio; quando nao existe, entra.
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

describe("aplicarLoteDeColunas -- o corpo que realmente sai", () => {
  it("⚠️ manda as SEIS listas, com esses nomes", async () => {
    // ⚠️ ESTE TESTE CAIU QUANDO `alvos` ENTROU (fatia 12), E FOI ELE FAZENDO O
    // TRABALHO DELE. O `toEqual` compara o corpo INTEIRO: campo novo no
    // `LoteDeColunas` que nao ganhe a linha correspondente dentro do
    // `aplicarLoteDeColunas` reprova aqui, em vez de ser descartado em
    // silencio e o lote responder 200 sem ter feito nada.
    await aplicarLoteDeColunas("b1", {
      criar: [
        {
          tmp: "t1",
          name: "Entregue",
          semantic: "DONE",
          // Spec 039 (F9): os dois campos novos do `criar` viajam junto.
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

  it("⚠️ o prefixo `tmp:` chega intacto ao servidor", async () => {
    // ⚠️ ELE E A RAZAO DE SER DO LOTE. Sem o prefixo, o backend nao distingue
    // "apelido que o cliente inventou" de "UUID digitado errado", e apagar uma
    // coluna mandando as tarefas para a que voce acabou de criar deixa de
    // funcionar -- que e o unico motivo pelo qual esta rota existe.
    await aplicarLoteDeColunas("b1", {
      apagar: [{ id: "c2", destino: "tmp:nova-1" }],
      ordem: ["tmp:nova-1"],
    });
    const { corpo } = requisicao();
    expect(corpo.apagar[0].destino).toBe("tmp:nova-1");
    expect(corpo.ordem[0]).toBe("tmp:nova-1");
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

  it("⚠️ a ORDEM da lista e a informacao -- ordenar destruiria o pedido", async () => {
    // Um `.sort()` acidental em qualquer ponto do caminho passaria pelo
    // servidor sem erro: a lista ordenada continua sendo o conjunto certo.
    await aplicarLoteDeColunas("b1", { ordem: ["d", "c", "b", "a"] });
    expect(requisicao().corpo.ordem).toEqual(["d", "c", "b", "a"]);
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
