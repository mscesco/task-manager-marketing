/**
 * O corpo que sai no `POST /solicitacoes/publico`. Mock do cliente HTTP esconde
 * campo que o cliente não repassa. O hop componente → api não é coberto aqui:
 * exigiria percorrer o formulário público inteiro até o envio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enviarSolicitacaoPublica } from "../api";

const RESPOSTA = { protocol: "ABC123", created: 1 };

function requisicao() {
  const chamada = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = chamada[1] as RequestInit;
  return { url: String(chamada[0]), init, corpo: JSON.parse(String(init.body)) };
}

const ITEM = {
  category: "arte",
  summary: "Preciso de um banner",
  answers: [{ label: "O que precisa?", value: "um banner" }],
};

const BASE = {
  requester_name: "Maria do Polo",
  requester_email: "maria@polo.ex",
  requester_phone: "11999990000",
  requester_department: "Coordenação",
  requester_polo: "Taboão",
  items: [ITEM],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 201,
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

describe("enviarSolicitacaoPublica: o corpo que realmente sai", () => {
  it("o `form_id` viaja: é ele que escolhe a fila", async () => {
    // Sem ele a solicitação cai na fila do workspace inteiro, sem erro nenhum.
    await enviarSolicitacaoPublica({ ...BASE, form_id: "f-123" });
    expect(requisicao().corpo.form_id).toBe("f-123");
  });

  it("sem `form_id`, ele simplesmente não aparece no corpo", async () => {
    // Ausente e `null` são coisas diferentes para o backend: ausente cai na
    // validação antiga (aba aberta durante o deploy).
    await enviarSolicitacaoPublica(BASE);
    expect(requisicao().corpo).not.toHaveProperty("form_id");
  });

  it("o corpo inteiro: o payload, o slug do ambiente e o honeypot vazio", async () => {
    // O slug e o honeypot são desta função, não de quem chama: sem eles o
    // servidor recusa o corpo.
    await enviarSolicitacaoPublica({ ...BASE, form_id: "f-1" });
    expect(requisicao().corpo).toEqual({
      ...BASE,
      form_id: "f-1",
      workspace_slug: expect.stringMatching(/.+/),
      website: "",
    });
  });

  it("vai sem credencial", async () => {
    // Quem preenche o formulário não tem login. Mandar `Authorization` faria a
    // chamada falhar justamente para quem ela existe para atender.
    await enviarSolicitacaoPublica(BASE);
    const cabecalhos = (requisicao().init.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBeUndefined();
  });
});
