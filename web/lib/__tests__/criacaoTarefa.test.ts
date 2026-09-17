import { describe, expect, it } from "vitest";
import {
  acaoDoEnterNoTitulo,
  alternaResponsavel,
  comTodosOsResponsaveis,
  todosJaEscolhidos,
  motivoNaoCria,
  podeCriar,
  resumoResponsaveis,
  proximoDaSequencia,
  type Rascunho,
} from "@/lib/criacaoTarefa";

function r(over: Partial<Rascunho> = {}): Rascunho {
  return { titulo: "", assigneeIds: [], dueDate: "", ...over };
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
    expect(motivoNaoCria(r({ assigneeIds: ["u1"] }))).toContain("título");
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
    expect(motivoNaoCria(r())).toContain("título");
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
    expect(acaoDoEnterNoTitulo(r())).toBe("nada");
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
  it("volta VAZIO -- a proxima subtarefa e OUTRA subtarefa (05/08)", () => {
    // ⚠️ Ate 05/08 este teste afirmava o contrario (mantinha responsavel e
    // prazo). Mudou por medicao na tela: o campo vinha preenchido com quem
    // nao devia, e designar sem querer nao da erro na hora -- quem descobre
    // e a pessoa errada, depois.
    const feito = r({ titulo: "Primeira", assigneeIds: ["u1"], dueDate: "2026-08-10" });
    const proximo = proximoDaSequencia(feito);
    expect(proximo.titulo).toBe("");
    expect(proximo.assigneeIds).toEqual([]);
    expect(proximo.dueDate).toBe("");
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

describe("proximoDaSequencia -- isolamento de referencia", () => {
  it("nao devolve a MESMA lista duas vezes", () => {
    // ⚠️ Espalhar uma constante "vazia" seria copia rasa: os dois resultados
    // dividiriam o mesmo array, e mutar um mexeria no outro (e na constante).
    const a = proximoDaSequencia(r({ titulo: "X", assigneeIds: ["u1"] }));
    const b = proximoDaSequencia(r({ titulo: "Y", assigneeIds: ["u2"] }));
    expect(a.assigneeIds).not.toBe(b.assigneeIds);
    a.assigneeIds.push("u9");
    expect(b.assigneeIds).toEqual([]);
  });
});

// =====================================================================
// "Selecionar todos" -- as duas funções puras (22/08).
// =====================================================================
describe("comTodosOsResponsaveis", () => {
  it("⚠️ SOMA à seleção, e não substitui", () => {
    // ⚠️ ESTE É O DEFEITO QUE A FUNÇÃO EXISTE PARA IMPEDIR. A tela passa a
    // lista FILTRADA pela busca; substituindo, digitar "an" e clicar em
    // "selecionar todos" apagaria quem já estava escolhido e não casa com
    // "an" -- destruir seleção num botão chamado "selecionar" é o oposto do
    // que ele promete.
    expect(comTodosOsResponsaveis(["carla"], ["ana"])).toEqual(["carla", "ana"]);
  });

  it("não duplica quem já estava", () => {
    expect(comTodosOsResponsaveis(["ana"], ["ana", "bruno"])).toEqual([
      "ana",
      "bruno",
    ]);
  });

  it("lista vazia de disponíveis não muda nada", () => {
    expect(comTodosOsResponsaveis(["ana"], [])).toEqual(["ana"]);
  });
});

describe("todosJaEscolhidos", () => {
  it("verdadeiro só quando todos os visíveis já estão", () => {
    expect(todosJaEscolhidos(["ana", "bruno"], ["ana", "bruno"])).toBe(true);
    expect(todosJaEscolhidos(["ana"], ["ana", "bruno"])).toBe(false);
  });

  it("⚠️ NENHUM disponível devolve `false`, e não `true`", () => {
    // "Todos de zero pessoas estão escolhidos" é verdade lógica e mentira de
    // interface: com a busca sem resultado, `true` esconderia o botão por um
    // motivo que a pessoa não tem como deduzir. A tela já trata o vazio com
    // "Ninguem encontrado".
    expect(todosJaEscolhidos([], [])).toBe(false);
    expect(todosJaEscolhidos(["ana"], [])).toBe(false);
  });

  it("selecionado que não está visível não conta como pendência", () => {
    // Com busca ativa, quem está escolhido fora do filtro não deve manter o
    // botão na tela: o que importa é o que a pessoa VÊ.
    expect(todosJaEscolhidos(["ana", "carla"], ["ana"])).toBe(true);
  });
});
