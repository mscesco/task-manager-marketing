// lib/__tests__/seguidores.test.ts -- Spec 053, fatia D
//
// SABOTAGENS (medidas):
//   A. Em `pessoasOferecidas`, apagar `|| jaSegue.has(m.id)` do filtro de
//      inativo. Deve cair "desativado que JA segue continua na lista".
//   B. Em `permissoesDeSeguidor`, devolver `seguirASiMesmo: true` para arquivada.
//      Deve cair "arquivada: ninguem mexe, nem em si mesmo".

import { describe, expect, it } from "vitest";

import {
  mensagemDeFalha,
  permissoesDeSeguidor,
  pessoasOferecidas,
  rotuloDoBotaoSeguir,
} from "@/lib/seguidores";

const MEMBROS = [
  { id: "u-caio", name: "Caio" },
  { id: "u-ana", name: "Ana" },
  { id: "u-bia", name: "Bia" },
  { id: "u-dani", name: "Dani" },
];

function oferecidas(over: Partial<Parameters<typeof pessoasOferecidas>[0]> = {}) {
  return pessoasOferecidas({
    membros: MEMBROS,
    busca: "",
    inativos: new Set(),
    foraDoEscopo: new Set(),
    marcados: [],
    ...over,
  });
}

describe("pessoasOferecidas", () => {
  it("ordena por nome", () => {
    expect(oferecidas().map((p) => p.name)).toEqual(["Ana", "Bia", "Caio", "Dani"]);
  });

  it("filtra pela busca, sem diferenciar maiusculas", () => {
    expect(oferecidas({ busca: "  bI " }).map((p) => p.id)).toEqual(["u-bia"]);
  });

  it("desativado e quem nao alcanca saem da lista", () => {
    const ids = oferecidas({
      inativos: new Set(["u-ana"]),
      foraDoEscopo: new Set(["u-bia"]),
    }).map((p) => p.id);
    expect(ids).toEqual(["u-caio", "u-dani"]);
  });

  it("⚠️ desativado que JA segue continua na lista, marcado como inativo", () => {
    const lista = oferecidas({ inativos: new Set(["u-ana"]), marcados: ["u-ana"] });
    expect(lista.find((p) => p.id === "u-ana")).toEqual({
      id: "u-ana",
      name: "Ana",
      inativo: true,
    });
  });

  it("⚠️ quem nao alcanca mas JA segue continua -- senao nao daria para tira-lo", () => {
    const ids = oferecidas({ foraDoEscopo: new Set(["u-bia"]), marcados: ["u-bia"] }).map(
      (p) => p.id,
    );
    expect(ids).toContain("u-bia");
  });
});

describe("permissoesDeSeguidor", () => {
  it("quem ve segue a si mesmo; mexer nos outros vem do servidor", () => {
    expect(permissoesDeSeguidor({ arquivada: false, podeGerenciar: true })).toEqual({
      seguirASiMesmo: true,
      mexerEmOutros: true,
    });
    expect(permissoesDeSeguidor({ arquivada: false, podeGerenciar: false })).toEqual({
      seguirASiMesmo: true,
      mexerEmOutros: false,
    });
  });

  it("campo ausente le-se como 'nao'", () => {
    expect(permissoesDeSeguidor({ arquivada: false, podeGerenciar: undefined }).mexerEmOutros).toBe(
      false,
    );
  });

  it("⚠️ arquivada: ninguem mexe, nem em si mesmo (D10)", () => {
    expect(permissoesDeSeguidor({ arquivada: true, podeGerenciar: true })).toEqual({
      seguirASiMesmo: false,
      mexerEmOutros: false,
    });
  });
});

describe("rotuloDoBotaoSeguir e mensagemDeFalha", () => {
  it("o botao troca de verbo", () => {
    expect(rotuloDoBotaoSeguir(false)).toBe("Seguir");
    expect(rotuloDoBotaoSeguir(true)).toBe("Deixar de seguir");
  });

  it("le o CODE da arquivada antes do status", () => {
    expect(mensagemDeFalha({ status: 422, code: "tarefa_arquivada" }, true)).toBe(
      "Tarefa arquivada: os seguidores não podem mudar.",
    );
    expect(mensagemDeFalha({ status: 422, code: "validation_error" }, false)).toBe(
      "Essa pessoa não alcança esta tarefa (fora do time).",
    );
  });

  it("403 e falha generica", () => {
    expect(mensagemDeFalha({ status: 403 }, false)).toBe(
      "Você não pode mudar quem segue esta tarefa.",
    );
    expect(mensagemDeFalha({ status: 500 }, true)).toBe(
      "Não consegui atualizar se você segue esta tarefa.",
    );
  });
});
