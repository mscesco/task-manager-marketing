/**
 * A lógica do editor de formulário (Spec 043, fatia C2).
 *
 * ⚠️⚠️ QUASE TUDO AQUI É SOBRE UM DEFEITO SÓ, e ele não dá erro nenhum: **a
 * pergunta que some sem sumir.** Uma condicional só aparece quando a
 * pergunta-alvo tem certo valor; se o alvo for apagado, mudar de tipo, perder
 * a alternativa citada ou for parar DEPOIS dela, a dependente simplesmente
 * nunca mais aparece no formulário público. Quem editou não vê nada
 * acontecer.
 *
 * O backend recusa os quatro caminhos. O papel destas funções é **não
 * oferecer** o que ele vai recusar — botão cinza com o motivo escrito é mais
 * gentil que uma caixa vermelha depois do clique.
 *
 * ⚠️ E AS REGRAS FORAM MEDIDAS, não inventadas: os 25 condicionais herdados do
 * formulário do Marketing foram conferidos um a um antes de virarem código.
 */

import { describe, expect, it } from "vitest";

import type { PerguntaDoEditor, SecaoDoEditor } from "../api";
import {
  alvosPossiveis,
  contaPerguntas,
  dependentesDe,
  exigeOpcoes,
  impedimentoParaMover,
  movido,
  ordenadasPorPosicao,
  sugereSlugDeSecao,
} from "../editorDeFormulario";

function pergunta(over: Partial<PerguntaDoEditor> = {}): PerguntaDoEditor {
  return {
    id: "q",
    section_id: "s",
    label: "Pergunta",
    kind: "texto",
    required: false,
    options: [],
    placeholder: null,
    help: null,
    show_if_question_id: null,
    show_if_value: null,
    position: 0,
    ...over,
  };
}

function secao(questions: PerguntaDoEditor[]): SecaoDoEditor {
  return {
    id: "s",
    slug: "foto",
    title: "Foto",
    emoji: "📷",
    sla_text: null,
    summary_question_id: null,
    position: 0,
    questions,
  };
}

/** O par clássico do Marketing: "Sessão de fotos" revela "Data da sessão". */
function comCondicional() {
  const alvo = pergunta({
    id: "alvo",
    label: "O que você precisa?",
    kind: "escolha",
    options: ["Sessão de fotos", "Edição de fotos"],
    position: 0,
  });
  const dep = pergunta({
    id: "dep",
    label: "Data da sessão",
    kind: "data",
    position: 1,
    show_if_question_id: "alvo",
    show_if_value: "Sessão de fotos",
  });
  return { alvo, dep, s: secao([alvo, dep]) };
}

describe("alvosPossiveis -- o select só oferece o que funciona", () => {
  it("⚠️ só perguntas de ESCOLHA que vêm ANTES", () => {
    const antesTexto = pergunta({ id: "a", kind: "texto", position: 0 });
    const antesEscolha = pergunta({
      id: "b",
      kind: "escolha",
      options: ["Sim", "Não"],
      position: 1,
    });
    const alvoDela = pergunta({ id: "c", position: 2 });
    const depoisEscolha = pergunta({
      id: "d",
      kind: "escolha",
      options: ["X"],
      position: 3,
    });
    const s = secao([antesTexto, antesEscolha, alvoDela, depoisEscolha]);

    expect(alvosPossiveis(s, alvoDela).map((q) => q.id)).toEqual(["b"]);
  });

  it("a primeira pergunta da seção não tem alvo nenhum", () => {
    // ⚠️ E É POR ISSO QUE O SELECT SOME NESSE CASO: um `<select>` vazio com o
    // rótulo "só aparece quando" faz procurar uma opção que não existe.
    const { alvo, s } = comCondicional();
    expect(alvosPossiveis(s, alvo)).toEqual([]);
  });

  it("⚠️ `multi` também serve de gatilho, e `data`/`link` não", () => {
    const multi = pergunta({
      id: "m",
      kind: "multi",
      options: ["A", "B"],
      position: 0,
    });
    const data = pergunta({ id: "d", kind: "data", position: 1 });
    const alvoDela = pergunta({ id: "z", position: 2 });
    const s = secao([multi, data, alvoDela]);
    expect(alvosPossiveis(s, alvoDela).map((q) => q.id)).toEqual(["m"]);
  });
});

describe("impedimentoParaMover -- o quarto caminho para a pergunta que some", () => {
  it("⚠️ subir a DEPENDENTE para cima do gatilho é impedido, e diz qual", () => {
    // Sem isto ela vira uma pergunta que se revela por algo ainda não
    // perguntado -- ou seja, nunca se revela.
    const { s } = comCondicional();
    const motivo = impedimentoParaMover(s, 1, -1);
    expect(motivo).toContain("Data da sessão");
  });

  it("⚠️ descer o GATILHO para baixo da dependente é o MESMO defeito", () => {
    // Duas mãos diferentes, um resultado só. É fácil prender uma e esquecer a
    // outra -- foi por isso que este teste existe separado do de cima.
    const { s } = comCondicional();
    expect(impedimentoParaMover(s, 0, 1)).toContain("Data da sessão");
  });

  it("mover onde não há condicional é livre", () => {
    const a = pergunta({ id: "a", position: 0 });
    const b = pergunta({ id: "b", position: 1 });
    expect(impedimentoParaMover(secao([a, b]), 0, 1)).toBeNull();
  });

  it("sair da borda não é impedimento, é um nada", () => {
    const { s } = comCondicional();
    expect(impedimentoParaMover(s, 0, -1)).toBeNull();
  });

  it("condicional apontando para pergunta que não está mais na seção é ignorada", () => {
    // ⚠️ DADO VELHO NÃO PODE TRAVAR A TELA. Se um `show_if_question_id` apontar
    // para fora (migração antiga, seção apagada), o certo é deixar mover e
    // deixar o backend falar -- e não congelar a pergunta para sempre.
    const orfa = pergunta({
      id: "o",
      position: 1,
      show_if_question_id: "sumiu",
      show_if_value: "x",
    });
    const s = secao([pergunta({ id: "a", position: 0 }), orfa]);
    expect(impedimentoParaMover(s, 1, -1)).toBeNull();
  });
});

describe("dependentesDe -- o aviso antes de excluir", () => {
  it("lista quem some junto", () => {
    const { s } = comCondicional();
    expect(dependentesDe(s, "alvo").map((q) => q.label)).toEqual([
      "Data da sessão",
    ]);
  });

  it("pergunta sem dependente devolve lista vazia", () => {
    const { s } = comCondicional();
    expect(dependentesDe(s, "dep")).toEqual([]);
  });
});

describe("movido", () => {
  it("⚠️ devolve A MESMA lista na borda -- quem chama usa a identidade", () => {
    // Subir o primeiro item não é erro, é um nada: sem esta identidade a tela
    // dispararia uma chamada de reordenação que não muda coisa alguma.
    const l = ["a", "b"];
    expect(movido(l, 0, -1)).toBe(l);
    expect(movido(l, 1, 1)).toBe(l);
  });

  it("troca de lugar sem mexer no original", () => {
    const l = ["a", "b", "c"];
    expect(movido(l, 2, -1)).toEqual(["a", "c", "b"]);
    expect(l).toEqual(["a", "b", "c"]);
  });
});

describe("ordenadasPorPosicao", () => {
  it("⚠️ não confia na ordem do array -- ordena por `position`", () => {
    // A API devolve ordenado hoje. Depender disso é o tipo de suposição que
    // passa verde por meses e quebra no dia em que alguém acrescenta um item.
    const s = secao([
      pergunta({ id: "b", position: 1 }),
      pergunta({ id: "a", position: 0 }),
    ]);
    expect(ordenadasPorPosicao(s.questions).map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("empate de posição desempata pelo id, e não fica instável", () => {
    const s = secao([
      pergunta({ id: "z", position: 0 }),
      pergunta({ id: "a", position: 0 }),
    ]);
    expect(ordenadasPorPosicao(s.questions).map((q) => q.id)).toEqual(["a", "z"]);
  });
});

describe("miudezas", () => {
  it("exigeOpcoes vale para escolha e multi", () => {
    expect(exigeOpcoes("escolha")).toBe(true);
    expect(exigeOpcoes("multi")).toBe(true);
    expect(exigeOpcoes("texto")).toBe(false);
  });

  it("contaPerguntas soma as seções", () => {
    const { s } = comCondicional();
    expect(contaPerguntas([s, secao([pergunta({ id: "x" })])])).toBe(3);
  });

  it("⚠️ o slug sugerido cabe no limite do banco e não tem acento", () => {
    // Ele é `String(60)` e vira `solicitation_item.category`. Acento aqui
    // viraria 422 na criação -- e o campo é permanente.
    expect(sugereSlugDeSecao("Criar uma arte")).toBe("criar-uma-arte");
    expect(sugereSlugDeSecao("Gravação de vídeo")).toBe("gravacao-de-video");
    expect(sugereSlugDeSecao("A".repeat(80)).length).toBe(60);
  });
});
