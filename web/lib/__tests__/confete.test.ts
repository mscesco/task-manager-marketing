// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const animate = vi.fn(() => Promise.resolve());
vi.mock("motion", () => ({ animate: () => animate() }));

import { CONFETE_PARTICULAS, soltarConfete } from "../confete";

function instalarMatchMedia(reduz: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: reduz, addEventListener() {}, removeEventListener() {} }),
  });
}

describe("soltarConfete", () => {
  beforeEach(() => animate.mockClear());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("solta uma partícula por voo, fixa no ponto, e some quando os voos acabam", async () => {
    instalarMatchMedia(false);
    soltarConfete({ x: 40, y: 50 });
    const caixa = document.querySelector<HTMLElement>("[data-confete]");
    expect(caixa).not.toBeNull();
    expect(caixa!.style.left).toBe("40px");
    expect(caixa!.children).toHaveLength(CONFETE_PARTICULAS);
    expect(animate).toHaveBeenCalledTimes(CONFETE_PARTICULAS);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("[data-confete]")).toBeNull();
  });

  it("⚠️ com prefers-reduced-motion não desenha nada", () => {
    instalarMatchMedia(true);
    soltarConfete(document.body);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("[data-confete]")).toBeNull();
  });

  it("sem origem, não faz nada", () => {
    instalarMatchMedia(false);
    soltarConfete(null);
    expect(animate).not.toHaveBeenCalled();
  });
});
