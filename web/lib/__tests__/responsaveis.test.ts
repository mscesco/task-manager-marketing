// lib/__tests__/responsaveis.test.ts
//
// SABOTAGEM (medida): em `mensagemDeFalhaDoResponsavel`, apagar o ramo de
// `field === "assignee_ids"`. Deve cair "⚠️ o 422 do ULTIMO responsavel nao
// fala de alcance" -- que e o defeito visto na tela em 17/09.

import { describe, expect, it } from "vitest";

import {
  bloqueioAoTirar,
  mensagemDeFalhaDoResponsavel,
  PRECISA_DE_UM_RESPONSAVEL,
} from "@/lib/responsaveis";

describe("bloqueioAoTirar", () => {
  it("tirar o unico responsavel e bloqueado antes de pedir", () => {
    expect(bloqueioAoTirar(["u-ana"], "u-ana")).toBe(PRECISA_DE_UM_RESPONSAVEL);
  });

  it("com mais de um, ou tirando quem nao esta, pode", () => {
    expect(bloqueioAoTirar(["u-ana", "u-bia"], "u-ana")).toBeNull();
    expect(bloqueioAoTirar(["u-ana"], "u-bia")).toBeNull();
  });
});

describe("mensagemDeFalhaDoResponsavel", () => {
  it("⚠️ o 422 do ULTIMO responsavel nao fala de alcance", () => {
    expect(
      mensagemDeFalhaDoResponsavel({
        status: 422,
        message: "Toda tarefa precisa de pelo menos um responsável.",
        details: { field: "assignee_ids" },
      }),
    ).toBe("Toda tarefa precisa de pelo menos um responsável.");
  });

  it("o 422 de alcance continua dizendo alcance", () => {
    expect(
      mensagemDeFalhaDoResponsavel({ status: 422, details: { field: "user_id" } }),
    ).toBe("Essa pessoa não alcança esta tarefa (fora do time).");
  });

  it("403 e falha generica", () => {
    expect(mensagemDeFalhaDoResponsavel({ status: 403 })).toBe(
      "Você não pode designar nesta tarefa.",
    );
    expect(mensagemDeFalhaDoResponsavel({ status: 500 })).toBe(
      "Não consegui atualizar o responsável.",
    );
  });
});
