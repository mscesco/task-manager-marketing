/**
 * O corpo que sai nas escritas de formulário. Mock do cliente HTTP esconde campo
 * que o cliente não repassa; o `toEqual` do objeto inteiro (e não
 * `toMatchObject`) cai quando um campo entra no tipo sem entrar no corpo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarFormulario, publicarFormulario, renomearFormulario } from "../api";

function corpoDaChamada() {
  const chamada = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = chamada[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
      text: async () => "{}",
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("criarFormulario -- o corpo inteiro", () => {
  it("⚠️ leva EXATAMENTE os quatro campos, e nada mais", async () => {
    await criarFormulario({
      team_id: "t-1",
      slug: "ti",
      title: "Pedido de acesso",
      description: "Diga o que precisa",
    });
    expect(corpoDaChamada()).toEqual({
      team_id: "t-1",
      slug: "ti",
      title: "Pedido de acesso",
      description: "Diga o que precisa",
    });
  });

  it("⚠️ `description` ausente vira `\"\"`, e não some do corpo", async () => {
    // O backend declara `description` com `default=""`; mandar o campo ausente
    // funcionaria, mas mandar `""` explícito mantém o corpo com forma estável
    // -- e é o que o `toEqual` acima prende.
    await criarFormulario({ team_id: "t-1", slug: "ti", title: "X" });
    expect(corpoDaChamada()).toEqual({
      team_id: "t-1",
      slug: "ti",
      title: "X",
      description: "",
    });
  });
});

describe("publicarFormulario e renomearFormulario", () => {
  it("publicar manda só `publicado`", async () => {
    await publicarFormulario("f-1", true);
    expect(corpoDaChamada()).toEqual({ publicado: true });
  });

  it("despublicar manda `false`, e não omite o campo", async () => {
    await publicarFormulario("f-1", false);
    expect(corpoDaChamada()).toEqual({ publicado: false });
  });

  it("⚠️ renomear repassa o patch INTEIRO, inclusive `null`", async () => {
    // Esta função não monta o corpo campo a campo: manda `body: patch` --
    // campo novo viaja sozinho, como o `updateTask`. E o `null` tem de
    // sobreviver: nos três rótulos de identificação ele significa DESLIGUE o
    // campo, e o backend distingue "não veio" de "veio null".
    await renomearFormulario("f-1", {
      title: "Novo título",
      polo_label: null,
    });
    expect(corpoDaChamada()).toEqual({
      title: "Novo título",
      polo_label: null,
    });
  });
});
