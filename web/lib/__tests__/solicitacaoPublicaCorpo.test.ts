/**
 * O CORPO que sai no `POST /solicitacoes/publico`.
 *
 * ⚠️ QUARTO ARQUIVO DESTE GÊNERO, e o quinto motivo é o mesmo dos outros
 * quatro: **mock do cliente HTTP esconde campo que o cliente não repassa.**
 * `createTaskCorpo` (13/08) e `loteDeColunasCorpo` nasceram depois do estrago;
 * este nasce DE UMA SABOTAGEM VERDE.
 *
 * ⚠️⚠️ E A SABOTAGEM VERDE VALE MAIS QUE O ARQUIVO. Ao ligar o `form_id` no
 * envio (Spec 043, fatia B), tirei a linha `form_id: formId` do componente
 * para conferir se algum teste caía. **Nenhum caiu** — os nove testes da porta
 * pública provam que o id chega ao COMPONENTE, e nenhum prova que ele entra no
 * CORPO. São hops diferentes, e eu tinha coberto só o primeiro.
 *
 * ⚠️ O QUE ESTE ARQUIVO AINDA NÃO COBRE, e é honesto dizer: o hop
 * **componente → api** continua ⚪ sem verificação. Ele exigiria montar as
 * ~580 linhas do formulário e percorrer identificação, seleção, seções e
 * revisão até o envio. Aqui se prova que a função HTTP leva o campo; que o
 * componente o passa, só olho humano — e a sabotagem acima é o registro de que
 * essa lacuna é conhecida, e não esquecida.
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

describe("enviarSolicitacaoPublica -- o corpo que realmente sai", () => {
  it("⚠️ o `form_id` VIAJA -- é ele que escolhe a FILA", async () => {
    // ⚠️ Sem ele a solicitação nasce órfã: continua na fila (o `JOIN` do
    // backend é `LEFT`), mas visível a quem tem `solicitation.review` no
    // workspace inteiro, em vez do time dono do formulário. É um defeito que
    // não dá erro nenhum -- aparece semanas depois como "por que a
    // solicitação do TI caiu na minha fila?".
    await enviarSolicitacaoPublica({ ...BASE, form_id: "f-123" });
    expect(requisicao().corpo.form_id).toBe("f-123");
  });

  it("sem `form_id`, ele simplesmente não aparece no corpo", async () => {
    // ⚠️ AUSENTE E `null` SÃO COISAS DIFERENTES para o backend: ausente cai na
    // validação antiga (compatibilidade da aba aberta durante o deploy);
    // `null` seria um valor, e um `?? null` bem-intencionado no caminho
    // mudaria o significado sem ninguém notar.
    await enviarSolicitacaoPublica(BASE);
    expect(requisicao().corpo).not.toHaveProperty("form_id");
  });

  it("⚠️ o `workspace_slug` e o honeypot entram sozinhos", async () => {
    // Os dois são responsabilidade DESTA função, e não de quem chama: o slug
    // vem do ambiente, e o honeypot vazio é o que distingue humano de bot no
    // backend. Quem chamasse sem eles enviaria um corpo que o servidor recusa.
    await enviarSolicitacaoPublica(BASE);
    const { corpo } = requisicao();
    expect(corpo.workspace_slug).toBeTruthy();
    expect(corpo.website).toBe("");
  });

  it("os dados do solicitante e os itens chegam inteiros", async () => {
    await enviarSolicitacaoPublica({ ...BASE, form_id: "f-1" });
    const { corpo } = requisicao();
    expect(corpo.requester_name).toBe("Maria do Polo");
    expect(corpo.items).toEqual([ITEM]);
  });

  it("⚠️ vai SEM credencial", async () => {
    // Quem preenche o formulário não tem login. Mandar `Authorization` faria a
    // chamada falhar justamente para quem ela existe para atender.
    await enviarSolicitacaoPublica(BASE);
    const cabecalhos = (requisicao().init.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBeUndefined();
  });
});
