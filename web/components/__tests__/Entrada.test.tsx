// A entrada escalonada (redesign 19/10). O que vale guardar aqui é a REGRA do
// atraso -- quem sobe depois de quem, e onde o escalonamento para --, porque
// um erro nela não dá tela vermelha: dá uma lista que demora a chegar.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import Entrada, { ENTRADA_MAX, ENTRADA_PASSO, propsDeEntrada } from "@/components/Entrada";
import { DUR } from "@/lib/motion";

afterEach(cleanup);

describe("Entrada", () => {
  it("embrulha cada filho e mantém o conteúdo na tela", () => {
    render(
      <Entrada className="faixa">
        <span>um</span>
        <span>dois</span>
      </Entrada>,
    );
    expect(screen.getByText("um").parentElement?.className).toBe("faixa");
    expect(screen.getByText("dois")).toBeTruthy();
  });

  it("escalona 40ms por vizinho, em --dur-4, e para no oitavo", () => {
    const atraso = (i: number) => propsDeEntrada(i, false).animate!.transition.delay;
    expect(propsDeEntrada(0, false).animate!.transition.duration).toBe(DUR[4]);
    expect(atraso(0)).toBe(0);
    expect(atraso(1)).toBeCloseTo(ENTRADA_PASSO);
    // O oitavo (índice 7) é o último com atraso próprio; o resto chega com ele.
    expect(atraso(ENTRADA_MAX - 1)).toBeCloseTo(7 * ENTRADA_PASSO);
    expect(atraso(ENTRADA_MAX)).toBe(atraso(ENTRADA_MAX - 1));
    expect(atraso(40)).toBe(atraso(ENTRADA_MAX - 1));
  });

  it("com menos movimento não nasce invisível", () => {
    expect(propsDeEntrada(3, true)).toEqual({});
  });
});
