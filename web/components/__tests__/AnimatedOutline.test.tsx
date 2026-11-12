// Contorno animado: acessibilidade e clique. A forma do traço não é coberta
// (em jsdom `offsetWidth` é 0 e o `<svg>` não monta); essa se confere na tela.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import AnimatedOutline, { useDrawnOutline } from "@/components/AnimatedOutline";

afterEach(cleanup);

/** Uma superfície clicável qualquer com o contorno. */
function Superficie({ onClick }: { onClick: () => void }) {
  const { target, outline } = useDrawnOutline(8);
  return (
    <button className="relative" onClick={onClick} {...target}>
      {outline}
      Abrir o time
    </button>
  );
}

describe("AnimatedOutline", () => {
  it("⚠️ é DECORAÇÃO: não aparece na árvore de acessibilidade", () => {
    const { container } = render(<AnimatedOutline show radius={8} />);
    const camada = container.firstElementChild;
    expect(camada?.getAttribute("aria-hidden")).toBe("true");
  });

  it("⚠️⚠️ é um <span>, e não um <div> -- ele vive dentro de <button>", () => {
    // `<div>` dentro de `<button>` é HTML inválido.
    const { container } = render(<AnimatedOutline show radius={8} />);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });

  it("⚠️⚠️ NÃO ROUBA O CLIQUE da superfície que ele contorna", () => {
    const abriu = vi.fn();
    render(<Superficie onClick={abriu} />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir o time/ }));
    expect(abriu).toHaveBeenCalledTimes(1);
  });

  it("a camada declara `pointer-events-none`", () => {
    // O teste do clique passa em jsdom mesmo sem a classe; este prende a causa.
    const { container } = render(<AnimatedOutline show radius={8} />);
    expect(container.firstElementChild?.className).toContain(
      "pointer-events-none",
    );
  });

  it("useDrawnOutline entrega os QUATRO gatilhos -- hover E foco", () => {
    // Só o mouse deixaria o teclado sem destaque.
    function Sonda() {
      const { target } = useDrawnOutline();
      return <span data-testid="chaves">{Object.keys(target).join(",")}</span>;
    }
    render(<Sonda />);
    expect(screen.getByTestId("chaves").textContent).toBe(
      "onMouseEnter,onMouseLeave,onFocus,onBlur",
    );
  });
});

