// AnchoredPanel -- regra 6, segunda metade (Spec 056, fatia J): o painel mede
// a PRÓPRIA largura e se desloca para não sair pela direita. O print dela de
// 07/10 tinha o painel de ordenação da Base cortado no canto da tela.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import AnchoredPanel, { type PanelBox } from "@/components/AnchoredPanel";

const originais = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth"),
};

afterEach(() => {
  cleanup();
  if (originais.offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originais.offsetWidth);
  if (originais.clientWidth) Object.defineProperty(Element.prototype, "clientWidth", originais.clientWidth);
});

function Painel({ left }: { left: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const box: PanelBox = { top: 10, left, width: 40, maxWidth: 984, paraCima: false, alinhadoADireita: false };
  return (
    <AnchoredPanel box={box} panelRef={ref} role="dialog" aria-label="Ordenação">
      <p>conteúdo</p>
    </AnchoredPanel>
  );
}

function medidas(painel: number, pagina: number) {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => painel });
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => pagina });
}

describe("AnchoredPanel não sai pela direita", () => {
  it("⚠️ mais largo do que o hook supôs: anda para a esquerda até caber", () => {
    medidas(480, 1000);
    render(<Painel left={600} />);
    // borda 1000 - 8 de margem - 480 de painel = 512
    expect(screen.getByRole("dialog").style.left).toBe("512px");
  });

  it("cabendo, fica onde o hook pôs", () => {
    medidas(200, 1000);
    render(<Painel left={600} />);
    expect(screen.getByRole("dialog").style.left).toBe("600px");
  });
});
