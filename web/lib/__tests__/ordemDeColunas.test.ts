/**
 * `lib/ordemDeColunas` (Spec 036, fatia 6b).
 *
 * ⚠️ ESTE ARQUIVO E O GUARDIAO DO ARRASTE, e o arraste nao aparece nele. O
 * `onDragEnd` nao roda em jsdom -- o produto ja tem dois assim. A regra de
 * "para onde a coluna vai" mora aqui de proposito, e o handler de arraste so
 * chama. Quebrar qualquer linha destas quebra os dois caminhos, e este e o
 * unico dos dois que fica vermelho.
 */

import { describe, expect, it } from "vitest";

import type { Coluna } from "@/lib/coluna";
import {
  moverColuna,
  ordemIgual,
  podeMover,
  reordenarColunas,
} from "@/lib/ordemDeColunas";

function col(id: string, position: number): Coluna {
  return {
    id,
    name: id.toUpperCase(),
    color: "#000000",
    position,
    semantic: "IN_PROGRESS",
    notify_deadline: true,
    is_default_target: false,
  };
}

/** Quatro colunas, como um quadro avulso recem-criado. */
const QUADRO: Coluna[] = [col("a", 0), col("b", 1), col("c", 2), col("d", 3)];

const ids = (cs: Coluna[] | null) => (cs === null ? null : cs.map((c) => c.id));

describe("reordenarColunas", () => {
  it("move para o meio", () => {
    expect(ids(reordenarColunas(QUADRO, "d", 1))).toEqual(["a", "d", "b", "c"]);
  });

  it("move para o comeco e para o fim", () => {
    expect(ids(reordenarColunas(QUADRO, "c", 0))).toEqual(["c", "a", "b", "d"]);
    expect(ids(reordenarColunas(QUADRO, "a", 3))).toEqual(["b", "c", "d", "a"]);
  });

  it("⚠️ nao muda a lista recebida", () => {
    // A tela guarda as colunas em estado do React. Mutar a entrada faria a
    // atualizacao otimista ora repintar, ora nao, dependendo de quem comparou
    // referencia -- e o sintoma seria "as vezes a coluna volta sozinha".
    const antes = ids(QUADRO);
    reordenarColunas(QUADRO, "a", 3);
    expect(ids(QUADRO)).toEqual(antes);
  });

  it("⚠️ devolve null quando o destino e a posicao atual", () => {
    // Sem isto, largar a coluna onde ela ja estava dispararia uma escrita.
    expect(reordenarColunas(QUADRO, "b", 1)).toBeNull();
  });

  it("⚠️ grampeia o destino fora da faixa, e nao recusa", () => {
    // No arraste o cursor passa do fim da lista o tempo todo. Recusar
    // transformaria um gesto comum em "nao aconteceu nada".
    expect(ids(reordenarColunas(QUADRO, "a", 99))).toEqual(["b", "c", "d", "a"]);
    expect(ids(reordenarColunas(QUADRO, "d", -5))).toEqual(["d", "a", "b", "c"]);
  });

  it("⚠️ id desconhecido devolve null, e nao estoura", () => {
    // A lista da tela pode estar velha: outra pessoa apagou a coluna enquanto
    // esta arrastava. Estourar deixaria a tela quebrada por um dado que ja
    // mudou; o servidor recusa esse caso com `colunas_divergentes`.
    expect(reordenarColunas(QUADRO, "sumiu", 0)).toBeNull();
  });

  it("lista de uma coluna nao tem para onde ir", () => {
    expect(reordenarColunas([col("a", 0)], "a", 0)).toBeNull();
    expect(reordenarColunas([col("a", 0)], "a", 5)).toBeNull();
  });

  it("lista vazia devolve null", () => {
    expect(reordenarColunas([], "a", 0)).toBeNull();
  });
});

describe("moverColuna", () => {
  it("anda uma casa para cada lado", () => {
    expect(ids(moverColuna(QUADRO, "b", "esquerda"))).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(ids(moverColuna(QUADRO, "b", "direita"))).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  it("⚠️ na ponta devolve null, e nao a mesma lista", () => {
    // ⚠️ E O QUE IMPEDE A SETA DE VIRAR REQUISICAO. Apertar ← na primeira
    // coluna mandaria ao servidor a ordem que ja esta la -- e como a lista e
    // valida, o endpoint ACEITA. A tela ficaria escrevendo a cada tecla sem
    // efeito nenhum, e nada apareceria errado.
    expect(moverColuna(QUADRO, "a", "esquerda")).toBeNull();
    expect(moverColuna(QUADRO, "d", "direita")).toBeNull();
  });

  it("id desconhecido devolve null", () => {
    expect(moverColuna(QUADRO, "sumiu", "direita")).toBeNull();
  });

  it("⚠️ 'esquerda' e menos um porque o quadro e HORIZONTAL", () => {
    // Se alguem trocar o sinal, a seta passa a andar para o lado contrario do
    // que o rotulo diz -- e no arraste nada muda, entao so este teste pega.
    const movida = moverColuna(QUADRO, "c", "esquerda")!;
    expect(movida.findIndex((c) => c.id === "c")).toBe(1);
  });
});

describe("podeMover", () => {
  it("as pontas nao podem para fora", () => {
    expect(podeMover(QUADRO, "a", "esquerda")).toBe(false);
    expect(podeMover(QUADRO, "a", "direita")).toBe(true);
    expect(podeMover(QUADRO, "d", "direita")).toBe(false);
    expect(podeMover(QUADRO, "d", "esquerda")).toBe(true);
  });

  it("coluna sozinha nao pode para lado nenhum", () => {
    expect(podeMover([col("a", 0)], "a", "esquerda")).toBe(false);
    expect(podeMover([col("a", 0)], "a", "direita")).toBe(false);
  });
});

describe("ordemIgual", () => {
  it("⚠️ compara ID e ORDEM, e ignora o resto", () => {
    // A resposta do servidor traz `position` ja densificada. Comparar objetos
    // daria "mudou" toda vez, e a tela repintaria a cada resposta.
    const mesmaOrdemOutraPosicao = QUADRO.map((c, i) => ({
      ...c,
      position: i + 100,
    }));
    expect(ordemIgual(QUADRO, mesmaOrdemOutraPosicao)).toBe(true);
  });

  it("ordem diferente e falso", () => {
    expect(ordemIgual(QUADRO, reordenarColunas(QUADRO, "a", 3)!)).toBe(false);
  });

  it("tamanho diferente e falso", () => {
    expect(ordemIgual(QUADRO, QUADRO.slice(0, 3))).toBe(false);
  });
});
