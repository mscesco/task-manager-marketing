import { describe, expect, it } from "vitest";

import { ordenar } from "@/lib/ordenacao";

const t = (
  id: string,
  created_at: string,
  due_date: string | null,
  priority: string
) => ({ id, created_at, due_date, priority });

const ids = (arr: { id: string }[]) => arr.map((x) => x.id);

describe("ordenar", () => {
  it("criacao: mais nova primeiro", () => {
    const itens = [
      t("velha", "2026-01-01T00:00:00Z", null, "LOW"),
      t("nova", "2026-05-01T00:00:00Z", null, "LOW"),
    ];
    expect(ids(ordenar(itens, "criacao"))).toEqual(["nova", "velha"]);
  });

  it("prazo: vencimento mais proximo primeiro, SEM PRAZO no fim", () => {
    const itens = [
      t("sem", "2026-05-01T00:00:00Z", null, "LOW"),
      t("longe", "2026-05-01T00:00:00Z", "2026-12-01", "LOW"),
      t("perto", "2026-05-01T00:00:00Z", "2026-06-01", "LOW"),
    ];
    expect(ids(ordenar(itens, "prazo"))).toEqual(["perto", "longe", "sem"]);
  });

  it("prioridade: urgente primeiro, desconhecida por ultimo", () => {
    const itens = [
      t("media", "2026-05-01T00:00:00Z", null, "MEDIUM"),
      t("urgente", "2026-05-01T00:00:00Z", null, "URGENT"),
      t("estranha", "2026-05-01T00:00:00Z", null, "SEI_LA"),
      t("alta", "2026-05-01T00:00:00Z", null, "HIGH"),
    ];
    expect(ids(ordenar(itens, "prioridade"))).toEqual([
      "urgente",
      "alta",
      "media",
      "estranha",
    ]);
  });

  it("empate SEMPRE desempata por criacao desc -- a lista nao treme", () => {
    const itens = [
      t("b", "2026-01-01T00:00:00Z", "2026-06-01", "HIGH"),
      t("a", "2026-05-01T00:00:00Z", "2026-06-01", "HIGH"),
    ];
    expect(ids(ordenar(itens, "prazo"))).toEqual(["a", "b"]);
    expect(ids(ordenar(itens, "prioridade"))).toEqual(["a", "b"]);
  });

  it("dois sem prazo desempatam por criacao, nao pela ordem de chegada", () => {
    const itens = [
      t("velha", "2026-01-01T00:00:00Z", null, "LOW"),
      t("nova", "2026-05-01T00:00:00Z", null, "LOW"),
    ];
    expect(ids(ordenar(itens, "prazo"))).toEqual(["nova", "velha"]);
  });

  it("nao muda o array original", () => {
    const itens = [
      t("a", "2026-01-01T00:00:00Z", null, "LOW"),
      t("b", "2026-05-01T00:00:00Z", null, "LOW"),
    ];
    ordenar(itens, "criacao");
    expect(ids(itens)).toEqual(["a", "b"]);
  });

  it("lista vazia nao quebra", () => {
    expect(ordenar([], "prioridade")).toEqual([]);
  });
});
