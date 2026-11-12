/**
 * A geometria do contorno desenhado. Em jsdom não há layout, então o `<svg>` do
 * `AnimatedOutline` nunca monta e nenhum teste de componente alcança a conta:
 * ela mora em `lib/outline.ts` para ser testada aqui.
 */

import { describe, it, expect } from "vitest";
import {
  INSET,
  outlinePath,
} from "../outline";

/** Os pontos do caminho, para o teste falar de geometria e não de formatação. */
function pathPoints(d: string): { x: number; y: number }[] {
  // Em `M x y`, `L x y` e `A rx ry rot arc sweep x y`, os dois últimos
  // números são o ponto de destino.
  const pontos: { x: number; y: number }[] = [];
  for (const trecho of d.split(/(?=[MLAZ])/)) {
    const t = trecho.trim();
    if (!t || t.startsWith("Z")) continue;
    const ns = t
      .slice(1)
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map(Number);
    if (ns.length >= 2) {
      pontos.push({ x: ns[ns.length - 2], y: ns[ns.length - 1] });
    }
  }
  return pontos;
}

describe("outlinePath", () => {
  it("⚠️⚠️ A STROKE_WIDTH INTEIRA CABE NO DESENHO", () => {
    // O traço cresce para os dois lados do caminho: caminho sobre a caixa
    // deixa metade fora da `viewBox`, e o corte aparece nas curvas.
    const w = 240;
    const h = 96;
    const pontos = pathPoints(outlinePath(w, h, 12));
    expect(pontos.length).toBeGreaterThan(0);
    for (const { x, y } of pontos) {
      expect(x).toBeGreaterThanOrEqual(INSET);
      expect(x).toBeLessThanOrEqual(w - INSET);
      expect(y).toBeGreaterThanOrEqual(INSET);
      expect(y).toBeLessThanOrEqual(h - INSET);
    }
  });

  it("começa no MEIO DA BASE, e o `Z` fecha de volta nele", () => {
    // Por isso é `<path>` e não `<rect>` (que começa no canto de cima). O
    // último trecho é do `Z`: sem ele o traço pararia no canto de baixo.
    const d = outlinePath(200, 80, 12);
    expect(d.startsWith(`M ${200 / 2} ${80 - INSET}`)).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("⚠️ O RAIO RECUA JUNTO com a caixa", () => {
    // Raio de fora na caixa de dentro: o traço cruzaria a borda no canto.
    // Com raio 12 e recuo 1, o arco tem de ser 11.
    expect(outlinePath(200, 80, 12)).toContain("A 11 11 0 0 1");
  });

  it("⚠️ raio 0 não vira raio NEGATIVO — a faixa de lista", () => {
    // As faixas de projeto e de tarefa não têm raio; arco de raio negativo
    // não desenha nada, e o contorno sumiria sem erro.
    const d = outlinePath(300, 56, 0);
    expect(d).toContain("A 0 0 0 0 1");
    expect(d).not.toContain("-1");
  });

  it("⚠️ superfície mais estreita que o raio não dobra a volta sobre si", () => {
    // Um cartão de 10px de altura com raio 12: sem o teto, os arcos seriam
    // maiores que a própria caixa.
    const d = outlinePath(200, 10, 12);
    for (const { y } of pathPoints(d)) {
      expect(y).toBeGreaterThanOrEqual(INSET);
      expect(y).toBeLessThanOrEqual(10 - INSET);
    }
  });
});

