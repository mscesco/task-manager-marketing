// EmojiPicker -- desde 08/10 no `AnchoredPanel` (era `absolute` no fluxo, e uma
// caixa com rolagem em volta o recortava).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmojiPicker from "@/components/EmojiPicker";

afterEach(cleanup);

describe("EmojiPicker", () => {
  it("abre o painel, insere o escolhido e fecha", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    const botao = screen.getByRole("button", { name: "Inserir emoji" });
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "🔥" }));
    expect(onPick).toHaveBeenCalledWith("🔥");
    expect(screen.queryByRole("dialog", { name: "Emojis" })).toBeNull();
  });

  it("clicar fora fecha; clicar dentro não", () => {
    render(
      <>
        <EmojiPicker onPick={vi.fn()} />
        <p>fora</p>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inserir emoji" }));
    const painel = screen.getByRole("dialog", { name: "Emojis" });
    fireEvent.mouseDown(painel);
    expect(screen.getByRole("dialog", { name: "Emojis" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByText("fora"));
    expect(screen.queryByRole("dialog", { name: "Emojis" })).toBeNull();
  });
});
