// CaixaDeDialogo -- a moldura única dos diálogos centrados (07/10: eram três
// cópias). A regra de fechar é de quem usa, e é isso que este arquivo prende.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CaixaDeDialogo from "@/components/CaixaDeDialogo";

afterEach(cleanup);

function abrir(props: Partial<Parameters<typeof CaixaDeDialogo>[0]> = {}) {
  render(
    <CaixaDeDialogo ariaLabel="Teste" largura={400} {...props}>
      <input aria-label="Campo" />
    </CaixaDeDialogo>,
  );
  const caixa = screen.getByRole("dialog", { name: "Teste" });
  return { caixa, fundo: caixa.parentElement as HTMLElement };
}

describe("CaixaDeDialogo", () => {
  it("Esc fecha -- e não fecha quando quem usa está ocupado (sem `onEsc`)", () => {
    const onEsc = vi.fn();
    const { caixa } = abrir({ onEsc });
    fireEvent.keyDown(caixa, { key: "Escape" });
    expect(onEsc).toHaveBeenCalledTimes(1);
    cleanup();
    const { caixa: ocupada } = abrir();
    fireEvent.keyDown(ocupada, { key: "Escape" }); // sem dono: nada a fazer
  });

  it("o fundo fecha só com o clique NO PRÓPRIO fundo -- apertar dentro não", () => {
    const onFundo = vi.fn();
    const { fundo } = abrir({ onFundo });
    fireEvent.mouseDown(screen.getByLabelText("Campo"));
    expect(onFundo).not.toHaveBeenCalled();
    fireEvent.mouseDown(fundo);
    expect(onFundo).toHaveBeenCalledTimes(1);
  });

  it("⚠️ diálogo destrutivo (sem `onFundo`): clicar ao lado não fecha", () => {
    const onEsc = vi.fn();
    const { fundo } = abrir({ onEsc });
    fireEvent.mouseDown(fundo);
    expect(onEsc).not.toHaveBeenCalled();
  });

  it("`isolarCliques`: o clique na caixa não chega ao documento (o painel que a abriu não fecha)", () => {
    const noDocumento = vi.fn();
    document.addEventListener("mousedown", noDocumento);
    try {
      abrir({ isolarCliques: true });
      fireEvent.mouseDown(screen.getByLabelText("Campo"));
      expect(noDocumento).not.toHaveBeenCalled();
      cleanup();
      abrir();
      fireEvent.mouseDown(screen.getByLabelText("Campo"));
      expect(noDocumento).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("mousedown", noDocumento);
    }
  });
});
