// Os campos da etapa de identificação do formulário público.

import { describe, expect, it } from "vitest";

import { camposDeIdentificacao } from "@/components/FormularioSolicitacao";

describe("camposDeIdentificacao", () => {
  it("⚠️ NOME e E-MAIL vêm sempre, e vêm primeiro", () => {
    // Não são configuráveis: a fila é organizada por quem pediu, e a resposta
    // automática de mudança de status precisa do endereço.
    const campos = camposDeIdentificacao({
      telefone: null,
      area: null,
      polo: null,
    });
    expect(campos.map((c) => c.id)).toEqual(["nome", "email"]);
  });

  it("o rótulo renomeado é o que aparece", () => {
    const campos = camposDeIdentificacao({
      telefone: "WhatsApp",
      area: null,
      polo: "Unidade",
    });
    expect(campos.map((c) => c.label)).toEqual([
      "Nome",
      "E-mail",
      "WhatsApp",
      "Unidade",
    ]);
  });
});
