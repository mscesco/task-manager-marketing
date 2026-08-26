// O adaptador que troca a FONTE do formulário público sem mexer no fluxo.
//
// ⚠️ POR QUE ELE MERECE TESTE PRÓPRIO: ele é o que permite a fatia B não
// reescrever as 922 linhas do `/solicitar`. A página consome `Categoria[]`
// desde sempre; o adaptador entrega essa forma a partir da API. Se ele errar,
// o erro aparece como campo faltando ou condicional que não some — na única
// porta pública do produto, e para quem não tem login para reclamar.
//
// SABOTAGENS previstas:
//   A. `opcoes: q.options` sem o teto de vazio -> cai "sem opções vira
//      undefined": a tela desenharia um select sem alternativa.
//   B. Deixar de filtrar seção sem pergunta -> cai "seção vazia é descartada".
//   C. `resumoDe: s.summary_question_id ?? ""` (sem a reserva) -> cai a
//      reserva no primeiro campo.

import { describe, expect, it } from "vitest";

import { paraCategorias, porSlug } from "@/lib/formularioDoBanco";
import type { FormularioPublico, PerguntaPublica } from "@/lib/api";

function pergunta(over: Partial<PerguntaPublica> = {}): PerguntaPublica {
  // ⚠️ Literal completo, SEM `as` -- fixture com `as` cala o `tsc` sobre campo
  // que não existe, e este objeto espelha um contrato de API.
  return {
    id: "q1",
    label: "O que precisa?",
    kind: "texto",
    required: false,
    options: [],
    placeholder: null,
    help: null,
    show_if_question_id: null,
    show_if_value: null,
    ...over,
  };
}

function form(over: Partial<FormularioPublico> = {}): FormularioPublico {
  return {
    id: "f1",
    slug: "marketing",
    title: "Solicitação ao Marketing",
    description: "",
    sections: [],
    ...over,
  };
}

describe("paraCategorias", () => {
  it("traduz seção e pergunta para a forma que a tela desenha", () => {
    const [cat] = paraCategorias(
      form({
        sections: [
          {
            slug: "arte",
            title: "Criar uma arte",
            emoji: "🖼️",
            sla_text: "5 dias úteis",
            summary_question_id: "q1",
            questions: [pergunta({ required: true, help: "Seja específico" })],
          },
        ],
      })
    );

    expect(cat.slug).toBe("arte");
    expect(cat.titulo).toBe("Criar uma arte");
    expect(cat.prazo).toBe("5 dias úteis");
    expect(cat.resumoDe).toBe("q1");
    expect(cat.campos[0]).toMatchObject({
      id: "q1",
      label: "O que precisa?",
      tipo: "texto",
      obrigatorio: true,
      ajuda: "Seja específico",
    });
  });

  it("⚠️ sem opções vira `undefined`, e não lista vazia", () => {
    // ⚠️ A TELA TESTA `campo.opcoes` PARA DECIDIR se desenha select ou input, e
    // `[]` é VERDADEIRO em JavaScript -- desenharia um select sem alternativa
    // nenhuma, que é um beco para quem responde.
    const [cat] = paraCategorias(
      form({
        sections: [
          {
            slug: "s", title: "S", emoji: "", sla_text: null,
            summary_question_id: null,
            questions: [pergunta({ options: [] })],
          },
        ],
      })
    );
    expect(cat.campos[0].opcoes).toBeUndefined();
  });

  it("com opções, elas passam na ordem", () => {
    const [cat] = paraCategorias(
      form({
        sections: [
          {
            slug: "s", title: "S", emoji: "", sla_text: null,
            summary_question_id: null,
            questions: [
              pergunta({ kind: "escolha", options: ["Sim", "Não", "Talvez"] }),
            ],
          },
        ],
      })
    );
    expect(cat.campos[0].opcoes).toEqual(["Sim", "Não", "Talvez"]);
  });

  it("a condicional vira `mostrarSe` com o ID da outra pergunta", () => {
    const [cat] = paraCategorias(
      form({
        sections: [
          {
            slug: "s", title: "S", emoji: "", sla_text: null,
            summary_question_id: null,
            questions: [
              pergunta({ id: "q1", kind: "escolha", options: ["Sim", "Não"] }),
              pergunta({
                id: "q2",
                label: "Qual o link?",
                show_if_question_id: "q1",
                show_if_value: "Sim",
              }),
            ],
          },
        ],
      })
    );
    expect(cat.campos[1].mostrarSe).toEqual({ campo: "q1", igual: "Sim" });
    // Sem condicional, o campo é sempre visível -- e `undefined` é o que o
    // `campoVisivel` já entende como "sempre".
    expect(cat.campos[0].mostrarSe).toBeUndefined();
  });

  it("⚠️ seção SEM pergunta é descartada", () => {
    // Ela apareceria no menu como um tipo de solicitação escolhível que, ao
    // ser aberto, não pergunta nada -- e a pessoa ficaria olhando uma tela
    // vazia sem saber se carregou errado.
    const cats = paraCategorias(
      form({
        sections: [
          {
            slug: "vazia", title: "Vazia", emoji: "", sla_text: null,
            summary_question_id: null, questions: [],
          },
          {
            slug: "cheia", title: "Cheia", emoji: "", sla_text: null,
            summary_question_id: null, questions: [pergunta()],
          },
        ],
      })
    );
    expect(cats.map((c) => c.slug)).toEqual(["cheia"]);
  });

  it("⚠️ tipo desconhecido some, e a seção sobrevive", () => {
    // O backend já recusa tipo fora da lista na escrita. Se um escapar por um
    // caminho novo, a tela pula A PERGUNTA em vez de quebrar o formulário
    // inteiro -- o resto continua respondível.
    const cats = paraCategorias(
      form({
        sections: [
          {
            slug: "s", title: "S", emoji: "", sla_text: null,
            summary_question_id: null,
            questions: [
              pergunta({ id: "q1", kind: "assinatura" }),
              pergunta({ id: "q2", label: "Fica" }),
            ],
          },
        ],
      })
    );
    expect(cats[0].campos.map((c) => c.id)).toEqual(["q2"]);
  });

  it("⚠️ sem resumo definido, cai no PRIMEIRO campo", () => {
    // O `summary` vai para a fila de triagem. Sem ele, o card lá mostra o
    // assunto e mais nada, e quem tria precisa abrir cada solicitação para
    // saber do que se trata. O primeiro campo é palpite ruim e ainda assim
    // melhor que vazio.
    const [cat] = paraCategorias(
      form({
        sections: [
          {
            slug: "s", title: "S", emoji: "", sla_text: null,
            summary_question_id: null,
            questions: [pergunta({ id: "primeiro" }), pergunta({ id: "outro" })],
          },
        ],
      })
    );
    expect(cat.resumoDe).toBe("primeiro");
  });
});

describe("porSlug", () => {
  it("indexa as categorias pelo slug", () => {
    const cats = paraCategorias(
      form({
        sections: [
          {
            slug: "arte", title: "Arte", emoji: "", sla_text: null,
            summary_question_id: null, questions: [pergunta()],
          },
        ],
      })
    );
    expect(porSlug(cats).arte.titulo).toBe("Arte");
  });
});
