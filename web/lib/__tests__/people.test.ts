// As iniciais do avatar são brancas: toda cor da paleta precisa de contraste AA com elas.
import { describe, expect, it } from "vitest";
import { AVATAR_CORES, AVATAR_SEM_ID } from "@/lib/people";

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrasteComBranco = (hex: string) => 1.05 / (luminancia(hex) + 0.05);

describe("paleta do avatar", () => {
  it.each([...AVATAR_CORES, AVATAR_SEM_ID])("%s tem contraste >= 4.5 com branco", (cor) => {
    expect(contrasteComBranco(cor)).toBeGreaterThanOrEqual(4.5);
  });

  it("a conta bate com a referência do WCAG", () => {
    expect(contrasteComBranco("#22c55e")).toBeCloseTo(2.28, 1); // a cor antiga que o axe recusou
  });
});
