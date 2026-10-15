// Spec 057 (15/10) -- copiar e colar várias células, no formato do Excel.
import { describe, expect, it } from "vitest";
import type { BaseColumn, BaseRow } from "@/lib/api";
import {
  colarGrade,
  copiarFaixa,
  faixaEntre,
  lerGrade,
  rotulosQueFaltam,
  separarVarios,
  valorColado,
} from "@/lib/baseClipboard";
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

  it("converte pelo tipo da coluna; o que passa da última linha vira linha nova", () => {
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
    // ⚠️ a 3ª linha não existe: vira linha NOVA (15/10, só a 1ª entrava)
    expect(r.novas).toEqual([{ t: "Terceiro", n: 1 }]);
    expect(r.fora).toBe(0);
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

describe("o que veio do Google Planilhas (15/10)", () => {
  it("⚠️ os chips de seleção múltipla vêm separados por vírgula", () => {
    expect(separarVarios("Formulário, Import, Site")).toEqual(["Formulário", "Import", "Site"]);
    const multi = col("m", "multi_select", [
      { id: "a", label: "Formulário", color: "blue" },
      { id: "b", label: "Import", color: "red" },
    ]);
    expect(valorColado(multi, "Formulário, Import", pessoa)).toEqual(["a", "b"]);
  });

  it("os rótulos que a coluna não tem saem para a tela criar, sem repetir", () => {
    const multi = col("m", "multi_select", [{ id: "a", label: "Import", color: "blue" }]);
    const faltam = rotulosQueFaltam(
      lerGrade("Import, Site\nSite, BQ"),
      [multi],
      0
    );
    expect(faltam.get("m")).toEqual(["Site", "BQ"]);
  });
});

