// Spec 052, fatia D -- o que salvar ao editar título e descrição no lugar.
import { describe, expect, it } from "vitest";
import { decidirDescricao, decidirTitulo, TITULO_MAXIMO_TAREFA } from "@/lib/edicaoNoLugar";

describe("decidirTitulo", () => {
  it("título novo salva, aparado", () => {
    expect(decidirTitulo("  Arte do CBV  ", "Arte")).toEqual({ tipo: "salvar", valor: "Arte do CBV" });
  });

  it("⭐ o mesmo título (ou só espaço a mais) não salva", () => {
    expect(decidirTitulo("Arte", "Arte")).toEqual({ tipo: "nada" });
    expect(decidirTitulo(" Arte ", "Arte")).toEqual({ tipo: "nada" });
  });

  it("⚠️ título apagado VOLTA ao original -- não vira erro nem PATCH", () => {
    expect(decidirTitulo("", "Arte")).toEqual({ tipo: "nada" });
    expect(decidirTitulo("   \n ", "Arte")).toEqual({ tipo: "nada" });
  });

  it("⚠️ quebra de linha colada vira espaço", () => {
    expect(decidirTitulo("Arte\ndo\r\n  CBV", "Arte")).toEqual({ tipo: "salvar", valor: "Arte do CBV" });
  });

  it("corta no teto do servidor", () => {
    const d = decidirTitulo("a".repeat(TITULO_MAXIMO_TAREFA + 10), "Arte");
    expect(d.tipo === "salvar" && d.valor.length).toBe(TITULO_MAXIMO_TAREFA);
  });
});

describe("decidirDescricao", () => {
  it("descrição nova salva, aparada e com as quebras do meio", () => {
    expect(decidirDescricao("linha 1\nlinha 2\n\n", "")).toEqual({
      tipo: "salvar",
      valor: "linha 1\nlinha 2",
    });
  });

  it("⭐ a mesma, com quebra no fim de um dos lados, não salva", () => {
    expect(decidirDescricao("briefing\n", "briefing")).toEqual({ tipo: "nada" });
    expect(decidirDescricao("briefing", "briefing\n")).toEqual({ tipo: "nada" });
    expect(decidirDescricao("", null)).toEqual({ tipo: "nada" });
  });

  it("apagar a descrição é um gesto válido", () => {
    expect(decidirDescricao("  ", "briefing")).toEqual({ tipo: "salvar", valor: "" });
  });
});
