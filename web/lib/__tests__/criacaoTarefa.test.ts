import { describe, expect, it } from "vitest";
import {
  acaoDoEnterNoTitulo,
  alternaResponsavel,
  motivoNaoCria,
  podeCriar,
  RASCUNHO_VAZIO,
  resumoResponsaveis,
  proximoDaSequencia,
  type Rascunho,
} from "@/lib/criacaoTarefa";

function r(over: Partial<Rascunho> = {}): Rascunho {
  return { ...RASCUNHO_VAZIO, ...over };
}

describe("motivoNaoCria / podeCriar", () => {
  it("titulo e responsavel prontos -> cria", () => {
    const rascunho = r({ titulo: "Revisar copy", assigneeIds: ["u1"] });
    expect(motivoNaoCria(rascunho)).toBe(null);
    expect(podeCriar(rascunho)).toBe(true);
  });

  it("SEM responsavel nao cria -- e os 44 casos medidos em producao", () => {
    const rascunho = r({ titulo: "Revisar copy" });
    expect(podeCriar(rascunho)).toBe(false);
    expect(motivoNaoCria(rascunho)).toContain("quem vai fazer");
  });

  it("sem titulo nao cria, e o motivo fala do titulo", () => {
    expect(motivoNaoCria(r({ assigneeIds: ["u1"] }))).toContain("titulo");
  });

  it("titulo so com espacos conta como vazio", () => {
    expect(podeCriar(r({ titulo: "   ", assigneeIds: ["u1"] }))).toBe(false);
  });

  it("prazo em branco NAO impede -- 'faz quando der' e decisao legitima", () => {
    expect(podeCriar(r({ titulo: "X", assigneeIds: ["u1"], dueDate: "" }))).toBe(true);
  });

  it("titulo cobrado antes do responsavel", () => {
    // Pedir "escolha quem vai fazer" para um campo vazio manda a pessoa
    // resolver a coisa errada primeiro.
    expect(motivoNaoCria(RASCUNHO_VAZIO)).toContain("titulo");
  });
});

describe("acaoDoEnterNoTitulo", () => {
  it("com titulo e responsavel, Enter cria", () => {
    expect(acaoDoEnterNoTitulo(r({ titulo: "X", assigneeIds: ["u1"] }))).toBe("criar");
  });

  it("com titulo e SEM responsavel, Enter abre o seletor -- nao cria", () => {
    // Criar aqui seria repetir exatamente o bug do TaskModal: Enter gerando
    // tarefa sem responsavel. Nao fazer nada deixaria a pessoa presa.
    expect(acaoDoEnterNoTitulo(r({ titulo: "X" }))).toBe("escolher");
  });

  it("com titulo vazio, Enter nao faz nada", () => {
    expect(acaoDoEnterNoTitulo(RASCUNHO_VAZIO)).toBe("nada");
    expect(acaoDoEnterNoTitulo(r({ titulo: "  ", assigneeIds: ["u1"] }))).toBe("nada");
  });
});

describe("alternaResponsavel", () => {
  it("adiciona quem nao esta e remove quem esta", () => {
    expect(alternaResponsavel([], "u1")).toEqual(["u1"]);
    expect(alternaResponsavel(["u1"], "u1")).toEqual([]);
    expect(alternaResponsavel(["u1"], "u2")).toEqual(["u1", "u2"]);
  });

  it("nao muta a lista recebida", () => {
    const antes = ["u1"];
    alternaResponsavel(antes, "u2");
    expect(antes).toEqual(["u1"]);
  });
});

describe("resumoResponsaveis", () => {
  const nomes: Record<string, string> = { u1: "Taila Silva", u2: "Monique Lopez" };
  const nomePor = (id: string) => nomes[id];

  it("vazio convida a atribuir", () => {
    expect(resumoResponsaveis([], nomePor)).toBe("Atribuir");
  });

  it("um mostra o nome", () => {
    expect(resumoResponsaveis(["u1"], nomePor)).toBe("Taila Silva");
  });

  it("vario mostra a contagem", () => {
    expect(resumoResponsaveis(["u1", "u2"], nomePor)).toBe("2 pessoas");
  });

  it("aguenta id sem nome resolvido", () => {
    expect(resumoResponsaveis(["desconhecido"], nomePor)).toBe("1 pessoa");
  });
});

describe("proximoDaSequencia", () => {
  it("limpa o titulo e mantem responsavel e prazo", () => {
    const feito = r({ titulo: "Primeira", assigneeIds: ["u1"], dueDate: "2026-08-10" });
    const proximo = proximoDaSequencia(feito);
    expect(proximo.titulo).toBe("");
    expect(proximo.assigneeIds).toEqual(["u1"]);
    expect(proximo.dueDate).toBe("2026-08-10");
  });

  it("o proximo ainda NAO pode ser criado -- falta o titulo", () => {
    expect(podeCriar(proximoDaSequencia(r({ titulo: "X", assigneeIds: ["u1"] })))).toBe(
      false
    );
  });

  it("copia a lista de responsaveis em vez de compartilhar a referencia", () => {
    const feito = r({ titulo: "X", assigneeIds: ["u1"] });
    const proximo = proximoDaSequencia(feito);
    proximo.assigneeIds.push("u2");
    expect(feito.assigneeIds).toEqual(["u1"]);
  });
});
