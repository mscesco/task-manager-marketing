// Spec 057 (15/10) -- copiar e colar várias células, no formato do Excel.
import { describe, expect, it } from "vitest";
import type { BaseColumn, BaseRow } from "@/lib/api";
import { colarGrade, copiarFaixa, faixaEntre, lerGrade, valorColado } from "@/lib/baseClipboard";
import { interpretarDigitado } from "@/lib/baseTable";

const col = (id: string, type: BaseColumn["type"], options: BaseColumn["options"] = []): BaseColumn => ({
  id,
  name: id,
  type,
  options,
  position: 1,
  width: null,
  version: 1,
});
const TITULO = col("t", "title");
const NUM = col("n", "number");
const SEL = col("s", "select", [{ id: "o1", label: "Instagram", color: "blue" }]);
const PES = col("p", "person");
const COLUNAS = [TITULO, NUM, SEL, PES];
const linha = (id: string, values: BaseRow["values"]): BaseRow =>
  ({ id, values, version: 1 }) as BaseRow;
const LINHAS = [linha("r1", { t: "Post 1", n: 10, s: "o1", p: ["ana"] }), linha("r2", { t: "Post 2" })];
const nome = (id: string) => ({ ana: "Ana" })[id] ?? "";
const pessoa = (n: string) => (n.toLowerCase() === "ana" ? "ana" : null);

describe("copiar", () => {
  it("vira o formato do Excel: TAB entre células, quebra entre linhas", () => {
    expect(copiarFaixa(LINHAS, COLUNAS, faixaEntre({ linha: 0, coluna: 0 }, { linha: 1, coluna: 3 }), nome)).toBe(
      "Post 1\t10\tInstagram\tAna\nPost 2\t\t\t"
    );
  });
});

describe("colar", () => {
  it("o Excel põe uma quebra no fim -- ela não vira linha", () => {
    expect(lerGrade("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("converte pelo tipo da coluna, e conta o que não serve e o que sobra", () => {
    const r = colarGrade(
      lerGrade("Novo\t1.200\tInstagram\tAna\nOutro\tabc\tTikTok\tFulano\nTerceiro\t1"),
      LINHAS,
      COLUNAS,
      { linha: 0, coluna: 0 },
      pessoa
    );
    expect(r.cells).toEqual([
      { row_id: "r1", column_id: "t", value: "Novo" },
      { row_id: "r1", column_id: "n", value: 1200 },
      { row_id: "r1", column_id: "s", value: "o1" },
      { row_id: "r1", column_id: "p", value: ["ana"] },
      { row_id: "r2", column_id: "t", value: "Outro" },
    ]);
    expect(r.invalidas).toBe(3); // abc, TikTok, Fulano
    expect(r.fora).toBe(2); // a 3ª linha não existe
  });

  it("vazio limpa a célula; caixinha aceita sim/não", () => {
    expect(valorColado(TITULO, "  ", pessoa)).toBeNull();
    expect(valorColado(col("c", "checkbox"), "Sim", pessoa)).toBe(true);
    expect(valorColado(col("c", "checkbox"), "talvez", pessoa)).toBeUndefined();
  });

  it("⚠️ '1.200' digitado é mil e duzentos, e não 1,2", () => {
    expect(interpretarDigitado(NUM, "1.200")).toEqual({ ok: true, valor: 1200 });
    expect(interpretarDigitado(NUM, "1.5")).toEqual({ ok: true, valor: 1.5 });
  });
});
