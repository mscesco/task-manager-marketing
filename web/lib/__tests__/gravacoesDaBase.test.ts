// As gravações de célula em voo de cada Base: a gravação conta enquanto está em
// voo, a geração sobe a cada uma, e `esperarGravacoes` espera inclusive as que falham.

import { describe, expect, it } from "vitest";

import {
  acompanhar,
  esperarGravacoes,
  geracao,
  haGravando,
} from "@/lib/gravacoesDaBase";

function adiada<T>() {
  let soltar!: (v: T) => void;
  let falhar!: (e: unknown) => void;
  const p = new Promise<T>((s, f) => {
    soltar = s;
    falhar = f;
  });
  return { p, soltar, falhar };
}

describe("gravacoesDaBase", () => {
  it("conta em voo, sobe a geração e espera inclusive a que falha", async () => {
    const g0 = geracao("b-x");
    const ok = adiada<number>();
    const ruim = adiada<number>();
    acompanhar("b-x", ok.p);
    acompanhar("b-x", ruim.p).catch(() => {});
    expect(haGravando("b-x")).toBe(true);
    expect(geracao("b-x")).toBe(g0 + 2);
    expect(haGravando("outra-base")).toBe(false);

    const espera = esperarGravacoes("b-x");
    ok.soltar(1);
    ruim.falhar(new Error("x"));
    await espera;
    await Promise.resolve();
    expect(haGravando("b-x")).toBe(false);
  });
});
