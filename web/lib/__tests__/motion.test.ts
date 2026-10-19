// `lib/motion.ts` espelha os tokens de movimento do `globals.css`. Este teste
// lê o CSS de verdade: o `include` do vitest não o alcança, e o par só se
// mantém se alguém conferir.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DUR, EASE } from "@/lib/motion";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

function token(nome: string): string {
  const m = css.match(new RegExp(`--${nome}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${nome} não está no globals.css`);
  return m[1].trim();
}

describe("lib/motion espelha o globals.css", () => {
  it("as quatro durações batem, em ms", () => {
    for (const n of [1, 2, 3, 4] as const) {
      expect(token(`dur-${n}`)).toBe(`${Math.round(DUR[n] * 1000)}ms`);
    }
  });

  it("as duas curvas batem", () => {
    // O CSS escreve `.22`; o TS, `0.22`. Compara-se os números, não o texto.
    const numeros = (nome: string) => token(nome).match(/-?[\d.]+/g)!.map(Number);
    expect(numeros("ease-out")).toEqual([...EASE.out]);
    expect(numeros("ease-io")).toEqual([...EASE.io]);
  });
});
