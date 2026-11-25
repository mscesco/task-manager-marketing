// Sem espaço embaixo, o painel abre para cima preso pelo pé: filtrar encolhe a
// lista e a busca desce junto, colada no `+`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import SeletorDePessoas from "@/components/SeletorDePessoas";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function abrirCom(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 0, left: 20, right: 320, width: 300, height: 26, x: 20, y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
  render(
    <SeletorDePessoas
      marcados={[]}
      nomes={new Map()}
      inativos={new Set()}
      oferecidas={[]}
      busca=""
      onBusca={() => {}}
      onAlternar={() => {}}
      podeAbrir
      rotuloDoBotao="Escolher seguidores"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Escolher seguidores" }));
  return screen.getByRole("dialog", { name: "Escolher seguidores" });
}

describe("SeletorDePessoas -- posição do painel", () => {
  it("perto do pé da janela, abre para cima preso pelo pé", () => {
    const h = window.innerHeight;
    const painel = abrirCom({ top: h - 60, bottom: h - 34 });
    expect(painel.style.bottom).toBe("66px");
    expect(painel.style.top).toBe("");
  });

  it("com espaço embaixo, abre para baixo preso pelo topo", () => {
    const painel = abrirCom({ top: 100, bottom: 126 });
    expect(painel.style.top).toBe("132px");
    expect(painel.style.bottom).toBe("");
  });
});
