/**
 * O CORPO que sai nas escritas de formulário (Spec 043).
 *
 * ⚠️⚠️ **QUINTO ARQUIVO DESTE GÊNERO, e o motivo é sempre o mesmo:** mock do
 * cliente HTTP esconde campo que o cliente não repassa. `createTaskCorpo`,
 * `duplicateTaskCorpo`, `loteDeColunasCorpo` e `solicitacaoPublicaCorpo`
 * nasceram todos depois de um estrago; este nasceu de uma revisão apontando
 * que o `AGENTS.md` §9 exige um guardião para toda função que monta corpo
 * campo a campo — e `criarFormulario` monta.
 *
 * ⚠️ O ROTEIRO DO DEFEITO, que já aconteceu três vezes (`board_id`,
 * `subtask_assignees`, `skip_subtasks`): alguém acrescenta um campo ao tipo,
 * o `tsc` fica verde, o teste de componente que mocka `api.criarFormulario`
 * fica verde — e o campo nunca chega ao backend, porque o `body:` interno não
 * o inclui. O `board_id` ficou de fora por um mês assim.
 *
 * ⚠️ E O `toEqual` SOBRE O OBJETO INTEIRO É O PONTO, não `toMatchObject`: ele
 * **cai quando um campo entra**, e é assim que lembra o próximo autor de pôr a
 * linha. Um teste que só confere os campos que já existem não guarda nada.
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

  it("⚠️ `is_published` NÃO viaja -- a decisão é do backend", async () => {
    // Formulário nasce despublicado, sempre. Se um dia alguém acrescentar o
    // campo ao tipo do input achando que controla isso daqui, o `toEqual` do
    // primeiro teste cai e a conversa acontece antes do defeito.
    await criarFormulario({ team_id: "t-1", slug: "ti", title: "X" });
    expect(corpoDaChamada()).not.toHaveProperty("is_published");
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
    // ⚠️ ESTA FUNÇÃO É IMUNE AO DEFEITO ACIMA porque manda `body: patch` --
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
