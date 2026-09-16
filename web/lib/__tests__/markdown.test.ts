// Spec 052, fatia C -- as regras da formatação: endereço, resumo e a barra.
import { describe, expect, it } from "vitest";
import {
  acaoDoAtalho,
  aplicarNaSelecao,
  enderecoSeguro,
  semMarcacao,
  type AcaoDaBarra,
} from "@/lib/markdown";

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
});

/** Aplica e devolve o texto com a seleção marcada por `[` e `]`. */
function marcar(acao: AcaoDaBarra, comSelecao: string): string {
  const inicio = comSelecao.indexOf("[");
  const fim = comSelecao.indexOf("]") - 1;
  const texto = comSelecao.replace("[", "").replace("]", "");
  const r = aplicarNaSelecao(acao, texto, inicio, fim);
  return r.texto.slice(0, r.inicio) + "[" + r.texto.slice(r.inicio, r.fim) + "]" + r.texto.slice(r.fim);
}

describe("aplicarNaSelecao -- cada botão da barra", () => {
  it("⭐ negrito envolve a seleção e mantém a palavra selecionada", () => {
    expect(marcar("negrito", "um [dois] três")).toBe("um **[dois]** três");
  });

  it("⚠️ negrito deixa o espaço selecionado FORA da marca", () => {
    expect(marcar("negrito", "um [dois ]três")).toBe("um **[dois]** três");
  });

  it("⭐ apertar de novo tira o negrito -- com ou sem as marcas na seleção", () => {
    expect(marcar("negrito", "um **[dois]** três")).toBe("um [dois] três");
    expect(marcar("negrito", "um [**dois**] três")).toBe("um [dois] três");
  });

  it("negrito sem seleção escreve um exemplo JÁ selecionado", () => {
    expect(marcar("negrito", "um [] três")).toBe("um **[texto em negrito]** três");
  });

  it("itálico usa um asterisco", () => {
    expect(marcar("italico", "[dois]")).toBe("*[dois]*");
  });

  it("título põe `## ` na linha inteira, mesmo com o cursor no meio", () => {
    expect(marcar("titulo", "antes\nObje[]tivo\ndepois")).toBe("antes\n[## Objetivo]\ndepois");
  });

  it("título de novo tira", () => {
    expect(marcar("titulo", "[## Objetivo]")).toBe("[Objetivo]");
  });

  it("⭐ lista marca cada linha da seleção, e pula linha em branco", () => {
    expect(marcar("lista", "[um\n\ndois]")).toBe("[- um\n\n- dois]");
  });

  it("numerada conta 1, 2, 3 -- e troca o marcador de lista que já havia", () => {
    expect(marcar("numerada", "[- um\n- dois\ntrês]")).toBe("[1. um\n2. dois\n3. três]");
  });

  it("⚠️ seleção terminando logo depois de uma quebra não pega a linha seguinte", () => {
    expect(marcar("lista", "[um\n]dois")).toBe("[- um]\ndois");
  });

  it("⭐ link com um NOME selecionado deixa o endereço selecionado", () => {
    expect(marcar("link", "a [Pasta] b")).toBe("a [Pasta]([https://]) b");
  });

  it("⭐ link com um ENDEREÇO selecionado deixa o NOME selecionado", () => {
    expect(marcar("link", "[https://drive.google.com/x]")).toBe("[[nome do link]](https://drive.google.com/x)");
  });
});

describe("acaoDoAtalho", () => {
  it("Ctrl ou Cmd + B, I, K", () => {
    expect(acaoDoAtalho({ key: "b", ctrlKey: true })).toBe("negrito");
    expect(acaoDoAtalho({ key: "I", metaKey: true })).toBe("italico");
    expect(acaoDoAtalho({ key: "k", ctrlKey: true })).toBe("link");
  });

  it("⚠️ sem Ctrl, ou com Shift/Alt, não é atalho (Ctrl+Shift+I abre o DevTools)", () => {
    expect(acaoDoAtalho({ key: "b" })).toBeNull();
    expect(acaoDoAtalho({ key: "i", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(acaoDoAtalho({ key: "Enter", ctrlKey: true })).toBeNull();
  });
});
