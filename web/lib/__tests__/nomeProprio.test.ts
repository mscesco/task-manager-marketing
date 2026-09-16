// Spec 051, fatia E -- editar o próprio nome.
import { describe, expect, it } from "vitest";
import { NOME_MAXIMO, nomeParaSalvar } from "@/lib/nomeProprio";

describe("nomeParaSalvar", () => {
  it("nome novo sai aparado", () => {
    expect(nomeParaSalvar("  Ana Souza  ", "Ana")).toBe("Ana Souza");
  });

  it("vazio, ou só espaço, não salva -- o servidor recusaria com 422", () => {
    expect(nomeParaSalvar("", "Ana")).toBe(null);
    expect(nomeParaSalvar("   ", "Ana")).toBe(null);
  });

  it("⚠️ igual ao atual depois de aparar não salva -- não mudaria nada", () => {
    expect(nomeParaSalvar("Ana ", "Ana")).toBe(null);
    expect(nomeParaSalvar("Ana", "Ana")).toBe(null);
  });

  it("acima do teto do servidor não salva", () => {
    expect(nomeParaSalvar("a".repeat(NOME_MAXIMO + 1), "Ana")).toBe(null);
    expect(nomeParaSalvar("a".repeat(NOME_MAXIMO), "Ana")).toBe("a".repeat(NOME_MAXIMO));
  });

  it("mudar só maiúscula é mudar", () => {
    expect(nomeParaSalvar("ana", "Ana")).toBe("ana");
  });
});
