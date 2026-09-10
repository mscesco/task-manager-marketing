/**
 * Spec 047, revisão de 10/09 — a geometria do contorno desenhado.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE: em jsdom não há layout, então o `<svg>` do
 * `AnimatedOutline` nunca monta e NENHUM teste de componente alcança o
 * caminho. Enquanto esta conta vivia dentro do `.tsx`, os portões todos
 * passavam com o traço cortado no canto — e quem pegou foi a Camila, na tela:
 * *"os contornos estão meio estranhos, não pegando muito bem os arredondados e
 * afins"*.
 *
 * SABOTAGENS medidas -- ver o fim do arquivo.
 */

import { describe, it, expect } from "vitest";
import {
  ESPESSURA,
  RECUO,
  caminhoDaVolta,
  pontosDoCaminho,
} from "../contorno";

describe("caminhoDaVolta", () => {
  it("⚠️⚠️ A ESPESSURA INTEIRA CABE NO DESENHO — era este o defeito", () => {
    // ⚠️ O caminho corria sobre a caixa (`0,0` a `w,h`), e um traço tem
    // espessura para os dois lados: 1px caía fora da `viewBox` e o navegador
    // cortava. Em reta o corte se esconde contra a borda do cartão; na CURVA
    // ele aparece, porque ali o traço encosta na borda em dois eixos.
    const w = 240;
    const h = 96;
    const pontos = pontosDoCaminho(caminhoDaVolta(w, h, 12));
    expect(pontos.length).toBeGreaterThan(0);
    for (const { x, y } of pontos) {
      expect(x).toBeGreaterThanOrEqual(RECUO);
      expect(x).toBeLessThanOrEqual(w - RECUO);
      expect(y).toBeGreaterThanOrEqual(RECUO);
      expect(y).toBeLessThanOrEqual(h - RECUO);
    }
  });

  it("o recuo é METADE da espessura, e não um número escolhido", () => {
    // ⚠️ Recuar a espessura inteira deixaria o traço 1px dentro da borda, e o
    // contorno pareceria descolado do cartão. É metade porque a linha cresce
    // para os dois lados a partir do caminho.
    expect(RECUO).toBe(ESPESSURA / 2);
  });

  it("começa no MEIO DA BASE, e o `Z` fecha de volta nele", () => {
    // ⚠️ É o pedido dela: *"uma linha pequena que corre contornando o card e
    // para embaixo"*. As duas pontas coincidem ali -- e é por isso que é um
    // `<path>` e não um `<rect>`, que sempre começa no canto de cima.
    //
    // ⚠️ QUEM DESENHA O ÚLTIMO TRECHO É O `Z`, e não um `L` final: ele fecha
    // do fim do último arco até o ponto do `M`. Por isso o último PONTO
    // escrito no caminho é o canto de baixo, e não o meio da base -- o
    // `pathOffset` chega a 1 no fim do `Z`. Sem o `Z` o traço pararia no
    // canto, que foi o que a primeira versão fazia.
    const d = caminhoDaVolta(200, 80, 12);
    expect(d.startsWith(`M ${200 / 2} ${80 - RECUO}`)).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("⚠️ O RAIO RECUA JUNTO com a caixa", () => {
    // ⚠️ Manter o raio de fora na caixa de dentro deixaria a curva mais aberta
    // que a do cartão, e o traço cruzaria a borda no meio do canto.
    // Com raio 12 e recuo 1, o arco tem de ser 11.
    expect(caminhoDaVolta(200, 80, 12)).toContain("A 11 11 0 0 1");
  });

  it("⚠️ raio 0 não vira raio NEGATIVO — a faixa de lista", () => {
    // ⚠️ A faixa de projeto e a de tarefa não têm raio (elas se dividem por
    // borda dentro de um contêiner que tem). `0 - RECUO` daria -1, e arco de
    // raio negativo não desenha nada -- o contorno simplesmente sumiria dessas
    // duas superfícies, sem erro nenhum.
    const d = caminhoDaVolta(300, 56, 0);
    expect(d).toContain("A 0 0 0 0 1");
    expect(d).not.toContain("-1");
  });

  it("⚠️ superfície mais estreita que o raio não dobra a volta sobre si", () => {
    // Um cartão de 10px de altura com raio 12: sem o teto, os arcos seriam
    // maiores que a própria caixa.
    const d = caminhoDaVolta(200, 10, 12);
    for (const { y } of pontosDoCaminho(d)) {
      expect(y).toBeGreaterThanOrEqual(RECUO);
      expect(y).toBeLessThanOrEqual(10 - RECUO);
    }
  });

  it("o raio 12 do `rounded-lg` deste projeto sai como 12, não como 8", () => {
    // ⚠️⚠️ O SEGUNDO defeito de 10/09, e ele não era de conta: o raio vinha
    // escrito à mão em cada chamador, e eu passei 8 em três de sete. Aqui
    // `rounded-lg` é **12px** -- o `@theme` do `globals.css` redefine
    // `--radius-lg`, e o Tailwind v4 gera as utilitárias a partir dali.
    // Hoje quem responde é o CSS da superfície (`raioDoPai`); este teste
    // guarda a conta que recebe a resposta.
    expect(caminhoDaVolta(240, 96, 12)).not.toEqual(
      caminhoDaVolta(240, 96, 8),
    );
  });
});

// SABOTAGENS medidas:
//   A. `RECUO = 0` (o caminho de volta sobre a borda, que era o defeito).
//      **Caem 4**.
//   B. Recuar a caixa e NÃO recuar o raio. **Cai 1** (o teste do arco 11).
//   C. Tirar o `Math.max(0, …)`. **Cai 1**: o contorno desaparece das faixas
//      de lista, silenciosamente.
//   D. Tirar os dois `Math.min`. **Cai 1**.
