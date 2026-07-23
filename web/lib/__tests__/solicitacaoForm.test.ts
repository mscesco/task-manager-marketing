// Exibicao condicional dos campos do formulario publico (Spec 025).
// Regra: sem `mostrarSe`, o campo aparece sempre; com `mostrarSe`, aparece
// so quando o campo-dependencia tem EXATAMENTE o valor indicado.
import { describe, expect, it } from "vitest";

import { campoVisivel, type Campo } from "@/lib/solicitacaoForm";

const SEMPRE: Campo = { id: "titulo", label: "Titulo", tipo: "texto" };

const CONDICIONAL: Campo = {
  id: "qual_evento",
  label: "Qual evento?",
  tipo: "texto",
  mostrarSe: { campo: "tem_evento", igual: "Sim" },
};

describe("campoVisivel", () => {
  it("campo sem condicao aparece sempre", () => {
    expect(campoVisivel(SEMPRE, {})).toBe(true);
    expect(campoVisivel(SEMPRE, { qualquer: "coisa" })).toBe(true);
  });

  it("condicional aparece quando a dependencia bate", () => {
    expect(campoVisivel(CONDICIONAL, { tem_evento: "Sim" })).toBe(true);
  });

  it("condicional some quando a dependencia tem outro valor", () => {
    expect(campoVisivel(CONDICIONAL, { tem_evento: "Nao" })).toBe(false);
  });

  it("condicional some quando a dependencia nem foi respondida", () => {
    // Estado inicial do formulario: ninguem preencheu nada ainda.
    expect(campoVisivel(CONDICIONAL, {})).toBe(false);
  });

  it("a comparacao e EXATA (nao normaliza caixa nem espaco)", () => {
    // Documenta o comportamento real: se um dia as opcoes do formulario
    // mudarem de "Sim" para "sim", o campo some silenciosamente.
    expect(campoVisivel(CONDICIONAL, { tem_evento: "sim" })).toBe(false);
    expect(campoVisivel(CONDICIONAL, { tem_evento: "Sim " })).toBe(false);
  });

  it("dependencia de multipla escolha (array) nao satisfaz igualdade", () => {
    // `valores` aceita string[] (campos multi). Comparar array com string
    // nunca da true -- logo, `mostrarSe` so funciona sobre campo de valor
    // unico. Fica registrado como limite conhecido.
    expect(campoVisivel(CONDICIONAL, { tem_evento: ["Sim"] })).toBe(false);
  });
});
