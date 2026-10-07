import { describe, expect, it } from "vitest";
import type { BaseColumn, BaseSummary, Team } from "@/lib/api";
import {
  agruparPorRaiz,
  avisoDeLinhas,
  corDaPessoa,
  dataParaTela,
  interpretarDigitado,
  mover,
  nomeConfere,
  proximaCor,
  raizDe,
  rotuloDePessoa,
  textoDaCelula,
  textoParaEditar,
} from "@/lib/baseTable";

const col = (type: BaseColumn["type"]): BaseColumn => ({
  id: "c1",
  name: "Coluna",
  type,
  options: [],
  position: 1,
  width: null,
  version: 1,
});

describe("dataParaTela", () => {
  it("reformata sem Date nem fuso", () => {
    expect(dataParaTela("2026-08-05")).toBe("05/08/2026");
  });
  it("deixa como veio o que não é AAAA-MM-DD", () => {
    expect(dataParaTela("ontem")).toBe("ontem");
  });
});

describe("rotuloDePessoa (D8, D22)", () => {
  const todos = new Map([
    ["ana", { name: "Ana", is_active: true }],
    ["bia", { name: "Bia", is_active: false }],
    ["caio", { name: "Caio", is_active: true }],
  ]);
  const daArvore = new Set(["ana", "bia"]);

  it("ativo e da árvore: só o nome", () => {
    expect(rotuloDePessoa("ana", daArvore, todos)).toBe("Ana");
  });
  it("conta desativada: inativo", () => {
    expect(rotuloDePessoa("bia", daArvore, todos)).toBe("Bia (inativo)");
  });
  it("⚠️ ativo mas fora da árvore NÃO é inativo", () => {
    expect(rotuloDePessoa("caio", daArvore, todos)).toBe("Caio (fora do time)");
  });
  it("desconhecido", () => {
    expect(rotuloDePessoa("zz", daArvore, todos)).toBe("Pessoa removida");
  });
});

describe("textoDaCelula e textoParaEditar", () => {
  it("número com vírgula, data no formato daqui, vazio vazio", () => {
    expect(textoDaCelula(col("number"), 1234.5)).toBe("1234,5");
    expect(textoDaCelula(col("date"), "2026-08-05")).toBe("05/08/2026");
    expect(textoDaCelula(col("text"), undefined)).toBe("");
  });
  it("o editor de número abre com vírgula", () => {
    expect(textoParaEditar(col("number"), 2.5)).toBe("2,5");
  });
});

describe("interpretarDigitado", () => {
  it("vazio esvazia a célula", () => {
    expect(interpretarDigitado(col("text"), "   ")).toEqual({ ok: true, valor: null });
  });
  it("texto apara as pontas", () => {
    expect(interpretarDigitado(col("title"), "  Collab  ")).toEqual({ ok: true, valor: "Collab" });
  });
  it("número aceita vírgula e milhar com ponto", () => {
    expect(interpretarDigitado(col("number"), "1.234,5")).toEqual({ ok: true, valor: 1234.5 });
    expect(interpretarDigitado(col("number"), "12,5")).toEqual({ ok: true, valor: 12.5 });
    expect(interpretarDigitado(col("number"), "1234.5")).toEqual({ ok: true, valor: 1234.5 });
    expect(interpretarDigitado(col("number"), "doze").ok).toBe(false);
  });
  it("data aceita AAAA-MM-DD e DD/MM/AAAA, e recusa dia que não existe", () => {
    expect(interpretarDigitado(col("date"), "05/08/2026")).toEqual({ ok: true, valor: "2026-08-05" });
    expect(interpretarDigitado(col("date"), "2026-08-05")).toEqual({ ok: true, valor: "2026-08-05" });
    expect(interpretarDigitado(col("date"), "31/02/2026").ok).toBe(false);
    expect(interpretarDigitado(col("date"), "29/02/2028").ok).toBe(true);
  });
  it("link só http e https", () => {
    expect(interpretarDigitado(col("link"), "https://instagram.com/p/x").ok).toBe(true);
    expect(interpretarDigitado(col("link"), "javascript:alert(1)").ok).toBe(false);
    expect(interpretarDigitado(col("link"), "instagram.com").ok).toBe(false);
  });
});

describe("mover (teclado, spec §12)", () => {
  const p = { linha: 1, coluna: 1 };
  it("setas andam uma casa e param na borda", () => {
    expect(mover(p, "ArrowUp", 3, 3)).toEqual({ linha: 0, coluna: 1 });
    expect(mover({ linha: 0, coluna: 0 }, "ArrowUp", 3, 3)).toEqual({ linha: 0, coluna: 0 });
    expect(mover({ linha: 2, coluna: 2 }, "ArrowRight", 3, 3)).toEqual({ linha: 2, coluna: 2 });
  });
  it("Enter desce, como numa planilha", () => {
    expect(mover(p, "Enter", 3, 3)).toEqual({ linha: 2, coluna: 1 });
  });
  it("Tab no fim da linha vai para a primeira da próxima; Shift+Tab volta", () => {
    expect(mover({ linha: 0, coluna: 2 }, "Tab", 3, 3)).toEqual({ linha: 1, coluna: 0 });
    expect(mover({ linha: 1, coluna: 0 }, "ShiftTab", 3, 3)).toEqual({ linha: 0, coluna: 2 });
    expect(mover({ linha: 2, coluna: 2 }, "Tab", 3, 3)).toEqual({ linha: 2, coluna: 2 });
  });
});

describe("agruparPorRaiz", () => {
  const time = (id: string, nome: string, pai: string | null = null): Team => ({
    id, workspace_id: "w", parent_team_id: pai, name: nome, slug: id,
  });
  const base = (id: string, team: string, nome: string): BaseSummary => ({
    id, team_id: team, name: nome, updated_at: "", can_update: true, can_delete: true,
  });
  it("um grupo por raiz, na ordem dos times, por nome dentro; sem grupo vazio", () => {
    const times = [time("mkt", "Marketing"), time("seo", "SEO", "mkt"), time("com", "Comercial")];
    const grupos = agruparPorRaiz(
      [base("b2", "mkt", "Pauta"), base("b1", "mkt", "Calendário"), base("b3", "com", "Metas")],
      times
    );
    expect(grupos.map((g) => g.raiz?.id)).toEqual(["mkt", "com"]);
    expect(grupos[0].bases.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
  it("base de time que a lista não trouxe vai para o fim, sem raiz", () => {
    const grupos = agruparPorRaiz([base("b1", "xx", "Solta")], []);
    expect(grupos).toEqual([{ raiz: null, bases: [base("b1", "xx", "Solta")] }]);
  });
});

describe("raizDe", () => {
  const t = (id: string, pai: string | null): Team => ({
    id, workspace_id: "w", parent_team_id: pai, name: id, slug: id,
  });
  const times = [t("mkt", null), t("seo", "mkt"), t("blog", "seo")];
  it("sobe até a raiz, de qualquer nível", () => {
    expect(raizDe("blog", times)).toBe("mkt");
    expect(raizDe("mkt", times)).toBe("mkt");
  });
  it("desconhecido ou nulo", () => {
    expect(raizDe("xx", times)).toBeNull();
    expect(raizDe(null, times)).toBeNull();
  });
});

describe("avisoDeLinhas (D23)", () => {
  it("nada abaixo do aviso", () => {
    expect(avisoDeLinhas(3999, 4000, 5000)).toBeNull();
  });
  it("aviso a partir de 4.000, teto em 5.000", () => {
    expect(avisoDeLinhas(4000, 4000, 5000)?.nivel).toBe("aviso");
    expect(avisoDeLinhas(5000, 4000, 5000)?.nivel).toBe("teto");
  });
});

describe("nomeConfere (D26)", () => {
  it("espaço nas pontas não conta, maiúscula conta", () => {
    expect(nomeConfere("  Calendário geral ", "Calendário geral")).toBe(true);
    expect(nomeConfere("calendário geral", "Calendário geral")).toBe(false);
  });
});

describe("proximaCor", () => {
  it("a primeira livre, e recomeça quando acaba", () => {
    expect(proximaCor([])).toBe("gray");
    expect(proximaCor(["gray", "brown"])).toBe("orange");
  });
});

describe("corDaPessoa (fatia J)", () => {
  const todos = new Map([
    ["ana", { name: "Ana", is_active: true }],
    ["bia", { name: "Bia", is_active: false }],
    ["caio", { name: "Caio", is_active: true }],
  ]);
  const daArvore = new Set(["ana", "bia"]);

  it("a mesma pessoa tem sempre a mesma cor, e nunca o cinza", () => {
    expect(corDaPessoa("ana", daArvore, todos)).toBe(corDaPessoa("ana", daArvore, todos));
    expect(corDaPessoa("ana", daArvore, todos)).not.toBe("gray");
  });
  it("as cores se espalham pela paleta", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `pessoa-${i}`);
    const arvore = new Set(ids);
    const conhecidas = new Map(ids.map((id) => [id, { name: id, is_active: true }]));
    expect(new Set(ids.map((id) => corDaPessoa(id, arvore, conhecidas))).size).toBeGreaterThan(4);
  });
  it("inativo, fora do time e desconhecido ficam cinza", () => {
    expect(corDaPessoa("bia", daArvore, todos)).toBe("gray");
    expect(corDaPessoa("caio", daArvore, todos)).toBe("gray");
    expect(corDaPessoa("zz", daArvore, todos)).toBe("gray");
  });
});
