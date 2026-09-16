// Spec 052, fatia C -- as regras da formatação: endereço e resumo.
// ⚠️ Os testes da barra que escrevia asteriscos saíram com ela, na fatia E.
import { describe, expect, it } from "vitest";
import { enderecoSeguro, semMarcacao } from "@/lib/markdown";

describe("enderecoSeguro", () => {
  it("http, https e mailto passam", () => {
    expect(enderecoSeguro("https://drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(enderecoSeguro("http://a.com")).toBe("http://a.com");
    expect(enderecoSeguro("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("⚠️ javascript:, data:, vbscript: e maiúsculas disfarçadas NÃO passam", () => {
    expect(enderecoSeguro("javascript:alert(1)")).toBeNull();
    expect(enderecoSeguro("JaVaScRiPt:alert(1)")).toBeNull();
    expect(enderecoSeguro(" javascript:alert(1)")).toBeNull();
    expect(enderecoSeguro("data:text/html,oi")).toBeNull();
    expect(enderecoSeguro("vbscript:x")).toBeNull();
  });

  it("⚠️ endereço relativo e vazio também não", () => {
    expect(enderecoSeguro("/api/v1/tasks")).toBeNull();
    expect(enderecoSeguro("#x")).toBeNull();
    expect(enderecoSeguro("")).toBeNull();
    expect(enderecoSeguro(undefined)).toBeNull();
  });
});

describe("semMarcacao", () => {
  it("⭐ tira a marcação de um resumo", () => {
    expect(semMarcacao("## Objetivo\n**Gestão** do *patrocínio* [pasta](https://x)")).toBe(
      "Objetivo\nGestão do patrocínio pasta",
    );
  });

  it("listas e numeradas perdem o marcador", () => {
    expect(semMarcacao("- um\n* dois\n1. três")).toBe("um\ndois\ntrês");
  });

  it("⚠️ texto sem marcação fica igual -- inclusive e-mail, URL e snake_case", () => {
    const t = "Investimento: R$ 550 mil/ano\nhttps://drive.google.com/a_b_c\nmaria_silva@x.com 2*3";
    expect(semMarcacao(t)).toBe(t);
  });

  it("⚠️ o escape que o editor da fatia E escreve some do resumo -- sem virar marcação", () => {
    expect(semMarcacao("\\[Design\\] Arte")).toBe("[Design] Arte");
    expect(semMarcacao("2 \\* 3 e 4 \\* 5")).toBe("2 * 3 e 4 * 5");
    expect(semMarcacao("arquivo\\_final\\_v2")).toBe("arquivo_final_v2");
  });

  it("⚠️ as entidades que o editor grava voltam a ser o caractere", () => {
    expect(semMarcacao("Trocar &lt;nome do cliente&gt; no texto")).toBe("Trocar <nome do cliente> no texto");
    expect(semMarcacao("P&amp;D e &amp;lt; literal")).toBe("P&D e &lt; literal");
  });
});
