import { describe, it, expect } from "vitest";
import {
  deveBloquearEnter,
  ehAtalhoDeSalvar,
  primeiroSelecionavel,
} from "@/lib/teclasFormulario";

describe("deveBloquearEnter", () => {
  it("bloqueia no input de texto -- e o caso do campo Titulo", () => {
    expect(deveBloquearEnter("INPUT")).toBe(true);
  });

  it("bloqueia no input de busca de pessoa (tambem INPUT)", () => {
    // Mesmo elemento, mas e o caso que mais doia: Enter ali criava a tarefa
    // com assignee_ids vazio.
    expect(deveBloquearEnter("input")).toBe(true);
  });

  it("bloqueia em select e em checkbox", () => {
    expect(deveBloquearEnter("SELECT")).toBe(true);
  });

  it("NAO bloqueia em textarea -- Enter ali e quebra de linha", () => {
    expect(deveBloquearEnter("TEXTAREA")).toBe(false);
    expect(deveBloquearEnter("textarea")).toBe(false);
  });

  it("NAO bloqueia em button -- Enter no botao focado e o clique dele", () => {
    expect(deveBloquearEnter("BUTTON")).toBe(false);
  });

  it("bloqueia quando a tag e desconhecida, nula ou vazia (lado seguro)", () => {
    expect(deveBloquearEnter(null)).toBe(true);
    expect(deveBloquearEnter(undefined)).toBe(true);
    expect(deveBloquearEnter("")).toBe(true);
    expect(deveBloquearEnter("DIV")).toBe(true);
  });
});

describe("ehAtalhoDeSalvar", () => {
  it("aceita Ctrl+Enter", () => {
    expect(ehAtalhoDeSalvar({ key: "Enter", ctrlKey: true })).toBe(true);
  });

  it("aceita Cmd+Enter (Mac)", () => {
    expect(ehAtalhoDeSalvar({ key: "Enter", metaKey: true })).toBe(true);
  });

  it("recusa Enter sozinho -- e exatamente o que o bug fazia", () => {
    expect(ehAtalhoDeSalvar({ key: "Enter" })).toBe(false);
    expect(ehAtalhoDeSalvar({ key: "Enter", ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("recusa outra tecla com Ctrl", () => {
    expect(ehAtalhoDeSalvar({ key: "s", ctrlKey: true })).toBe(false);
    expect(ehAtalhoDeSalvar({ key: "Escape", metaKey: true })).toBe(false);
  });
});

describe("primeiroSelecionavel", () => {
  it("devolve o primeiro id da lista ja filtrada", () => {
    const itens = [{ id: "u2" }, { id: "u1" }];
    // A lista chega ordenada pelo componente -- a funcao respeita a ordem
    // recebida, nao reordena por conta propria.
    expect(primeiroSelecionavel(itens)).toBe("u2");
  });

  it("devolve null quando a busca nao achou ninguem", () => {
    expect(primeiroSelecionavel([])).toBe(null);
  });
});
