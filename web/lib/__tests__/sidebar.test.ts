/**
 * Persistencia do estado da barra lateral (Spec 039, F3-bis).
 *
 * ⚠️ O caso que mais importa aqui NAO e "grava e le" -- e o de valor
 * CORROMPIDO. `v === "true"` sozinho transformaria qualquer lixo em `false`, e
 * barra fechada sem ninguem ter fechado e mais confuso que barra aberta.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_BARRA_ABERTA,
  CHAVE_QUADROS_ABERTO,
  gravarBarraAberta,
  gravarQuadrosAberto,
  lerBarraAberta,
  lerQuadrosAberto,
} from "@/lib/sidebar";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("lerBarraAberta", () => {
  it("sem nada gravado, a barra nasce ABERTA (comportamento de sempre)", () => {
    expect(lerBarraAberta()).toBe(true);
  });

  it("le o que foi gravado, nos dois sentidos", () => {
    gravarBarraAberta(false);
    expect(lerBarraAberta()).toBe(false);
    gravarBarraAberta(true);
    expect(lerBarraAberta()).toBe(true);
  });

  it("⚠️ valor CORROMPIDO cai no padrao, e nao em `false`", () => {
    for (const lixo of ["1", "sim", "", "TRUE", "{}", "null"]) {
      window.localStorage.setItem(CHAVE_BARRA_ABERTA, lixo);
      expect(lerBarraAberta()).toBe(true);
    }
  });

  it("⚠️ localStorage que LANCA nao derruba a leitura", () => {
    // Modo privado com cookies bloqueados: o getItem lanca. Preferencia de
    // barra lateral nao vale quebrar a pagina.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(lerBarraAberta()).toBe(true);
  });

  it("⚠️ localStorage que LANCA na ESCRITA nao derruba a acao", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => gravarBarraAberta(false)).not.toThrow();
  });
});

describe("lerQuadrosAberto", () => {
  it("padrao aberto, e as duas chaves nao se misturam", () => {
    expect(lerQuadrosAberto()).toBe(true);

    // ⚠️ Grava SO a barra e confere que o accordion nao mudou: chave trocada
    // faria retrair a barra fechar o grupo Quadros junto, sem ninguem pedir.
    gravarBarraAberta(false);
    expect(lerQuadrosAberto()).toBe(true);

    gravarQuadrosAberto(false);
    expect(lerQuadrosAberto()).toBe(false);
    expect(lerBarraAberta()).toBe(false); // segue o que foi gravado antes
    expect(window.localStorage.getItem(CHAVE_QUADROS_ABERTO)).toBe("false");
  });
});
