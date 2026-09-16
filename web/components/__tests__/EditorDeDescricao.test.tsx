// Spec 052, fatia E -- o editor de descrição que já mostra formatado, montado.
//
// O que ele prende:
//   - ⭐ o texto salvo abre FORMATADO, sem asterisco e sem aba "Visualizar";
//   - ⭐ ABRIR SEM MEXER NÃO CHAMA `onChange` -- nem com um texto que o editor
//     reescreveria (`[Design]`, `1)`). É o que impede clicar fora de uma
//     descrição intocada de salvá-la reescrita;
//   - os botões da barra formatam, e o clique neles não tira o foco;
//   - ⭐ colar Markdown entra formatado; colar texto comum entra como texto;
//   - Ctrl+K abre o campo de link, que completa o https://;
//   - um `valor` que chega de fora (a cópia do duplicar) entra no editor.
//
// Digitar `- ` virando lista está em `lib/__tests__/editorDeDescricao.test.ts`
// (o jsdom não digita num `contenteditable`).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";

import EditorDeDescricao from "@/components/EditorDeDescricao";
import { prepararEditorNoJsdom } from "./editorNoJsdom";

prepararEditorNoJsdom();
afterEach(cleanup);

async function montar(valor: string, onChange = vi.fn()) {
  const utils = render(
    <>
      <span id="rotulo">Descrição</span>
      <EditorDeDescricao valor={valor} onChange={onChange} rotuloId="rotulo" />
    </>,
  );
  const el = await screen.findByRole("textbox", { name: "Descrição" });
  await waitFor(() => expect((el as unknown as { editor?: Editor }).editor).toBeTruthy());
  const editor = (el as unknown as { editor: Editor }).editor;
  return { ...utils, el, editor, onChange };
}

/** Um `paste` como o navegador manda -- o jsdom não tem `DataTransfer`. */
function colar(el: HTMLElement, dados: Record<string, string>) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { types: Object.keys(dados), getData: (t: string) => dados[t] ?? "" },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe("EditorDeDescricao (fatia E)", () => {
  it("⭐ abre FORMATADO: sem asterisco, sem aba \"Visualizar\"", async () => {
    const { el } = await montar("**neg** e texto\n\n- um\n- dois");
    expect(el.querySelector("strong")?.textContent).toBe("neg");
    expect(el.querySelectorAll("ul li")).toHaveLength(2);
    expect(el.textContent).not.toContain("*");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("⭐⚠️ abrir sem mexer NÃO chama onChange -- nem com texto que o editor reescreveria", async () => {
    const { onChange } = await montar("[Design] Arte do CBV\nlinha 2\n\n1) item\n\narquivo_v2 2 * 3");
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("⭐ o botão Lista formata e avisa com Markdown", async () => {
    const { editor, onChange } = await montar("comprar tinta");
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(onChange).toHaveBeenLastCalledWith("- comprar tinta");
  });

  it("o botão Negrito fica marcado quando o cursor está em negrito", async () => {
    const { editor } = await montar("**neg**");
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(screen.getByRole("button", { name: "Negrito (Ctrl+B)" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("⚠️ o mousedown na barra é cancelado -- o editor não perde o foco", async () => {
    await montar("texto");
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Lista numerada" }))).toBe(false);
  });

  it("⭐ colar Markdown entra formatado", async () => {
    const { el, editor, onChange } = await montar("");
    act(() => {
      editor.commands.focus();
    });
    colar(el, { "text/plain": "## Objetivo\n\n- um\n- **dois**" });
    expect(el.querySelector("h2")?.textContent).toBe("Objetivo");
    expect(el.querySelectorAll("ul li")).toHaveLength(2);
    expect(el.querySelector("strong")?.textContent).toBe("dois");
    expect(el.textContent).not.toContain("*");
    expect(onChange).toHaveBeenCalled();
  });

  it("⚠️ colar texto comum NÃO vira formatação (2 * 3 não é itálico)", async () => {
    const { el, editor } = await montar("");
    act(() => {
      editor.commands.focus();
    });
    colar(el, { "text/plain": "Conta: 2 * 3 * 4" });
    expect(el.querySelector("em, strong, ul, h2")).toBeNull();
  });

  it("Ctrl+K abre o campo de link, que completa o https://", async () => {
    const { el, onChange } = await montar("");
    fireEvent.keyDown(el, { key: "k", ctrlKey: true });
    const campo = await screen.findByLabelText("Endereço do link");
    fireEvent.change(campo, { target: { value: "drive.google.com/x" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("[https://drive.google.com/x](https://drive.google.com/x)"),
    );
  });

  it("⚠️ link com javascript: é recusado no campo", async () => {
    const { el, onChange } = await montar("");
    fireEvent.keyDown(el, { key: "k", ctrlKey: true });
    const campo = await screen.findByLabelText("Endereço do link");
    fireEvent.change(campo, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("http");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("um valor que chega de FORA entra no editor, sem ecoar onChange", async () => {
    const onChange = vi.fn();
    const { rerender, el } = await montar("", onChange);
    rerender(
      <>
        <span id="rotulo">Descrição</span>
        <EditorDeDescricao valor={"cópia **da origem**"} onChange={onChange} rotuloId="rotulo" />
      </>,
    );
    await waitFor(() => expect(el.querySelector("strong")?.textContent).toBe("da origem"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
