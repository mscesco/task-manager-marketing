// Exibicao condicional dos campos do formulario publico (Spec 025).
// Regra: sem `mostrarSe`, o campo aparece sempre; com `mostrarSe`, aparece
// so quando o campo-dependencia tem EXATAMENTE o valor indicado (ou o inclui,
// se for de multipla escolha) e esta ele mesmo visivel.
import { describe, expect, it } from "vitest";

import { campoVisivel, novaRepeticao, type Campo } from "@/lib/solicitacaoForm";

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

  it("gatilho de multipla escolha: vale quando a resposta INCLUI a alternativa", () => {
    // 16/10, a auditoria: o editor e o servidor aceitam `multi` como gatilho,
    // e a comparacao array === string deixava a dependente invisivel para
    // sempre ("mostrar Data se Redes = Instagram").
    expect(campoVisivel(CONDICIONAL, { tem_evento: ["Nao", "Sim"] })).toBe(true);
    expect(campoVisivel(CONDICIONAL, { tem_evento: ["Nao"] })).toBe(false);
    expect(campoVisivel(CONDICIONAL, { tem_evento: [] })).toBe(false);
  });

  it("em cadeia, gatilho escondido esconde a dependente", () => {
    // P1 = Sim mostra P2; P2 = Presencial mostra P3. Voltar P1 para Nao
    // escondia P2 mas deixava P3 na tela -- obrigatoria e enviada.
    const p1: Campo = { id: "p1", label: "Tem evento?", tipo: "escolha" };
    const p2: Campo = { id: "p2", label: "Formato", tipo: "escolha", mostrarSe: { campo: "p1", igual: "Sim" } };
    const p3: Campo = { id: "p3", label: "Local", tipo: "texto", mostrarSe: { campo: "p2", igual: "Presencial" } };
    const campos = [p1, p2, p3];
    expect(campoVisivel(p3, { p1: "Sim", p2: "Presencial" }, campos)).toBe(true);
    expect(campoVisivel(p3, { p1: "Nao", p2: "Presencial" }, campos)).toBe(false);
  });

  it("ciclo (que o servidor recusa) nao trava", () => {
    const a: Campo = { id: "a", label: "A", tipo: "escolha", mostrarSe: { campo: "b", igual: "x" } };
    const b: Campo = { id: "b", label: "B", tipo: "escolha", mostrarSe: { campo: "a", igual: "x" } };
    expect(campoVisivel(a, { a: "x", b: "x" }, [a, b])).toBe(true);
  });
});

describe("novaRepeticao (Spec 059)", () => {
  it("a primeira é o próprio slug; as outras, o menor #n livre", () => {
    expect(novaRepeticao("evento", [])).toBe("evento");
    expect(novaRepeticao("evento", ["evento"])).toBe("evento#2");
    expect(novaRepeticao("evento", ["evento", "evento#2", "evento#3"])).toBe("evento#4");
    // Removida a 2, a nova reaproveita o número -- as que ficam não renumeram.
    expect(novaRepeticao("evento", ["evento", "evento#3"])).toBe("evento#2");
  });
});
