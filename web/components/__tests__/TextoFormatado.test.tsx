// Spec 052, fatia C -- o que a descrição desenha, o que ela NÃO desenha, e o
// editor com a barra.
//
// O que ele prende:
//   - ⭐ o briefing de uma solicitação sai com as MESMAS quebras de hoje (linha
//     simples vira `<br>`, linha em branco separa parágrafo);
//   - ⚠️ HTML escrito à mão aparece como texto, e nunca vira elemento;
//   - ⚠️ `javascript:` não vira link; link bom abre em aba nova;
//   - título nunca compete com a página (`#` vira `<h3>`);
//   - tabela, imagem e código não viram elemento;
//   - o editor: botão da barra escreve em volta da SELEÇÃO do campo; Ctrl+B
//     também; "Visualizar" mostra formatado; o clique na barra não tira o foco.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import TextoFormatado from "@/components/TextoFormatado";
import EditorDeDescricao from "@/components/EditorDeDescricao";

afterEach(cleanup);

function html(texto: string): string {
  const { container } = render(<TextoFormatado texto={texto} />);
  return container.querySelector(".texto-formatado")!.innerHTML;
}

describe("TextoFormatado", () => {
  it("⭐ o briefing de uma solicitação: quebra simples vira <br>, linha em branco separa", () => {
    // O formato de `backend/app/modules/solicitations/domain/briefing.py`.
    const briefing = [
      "[Design] Arte do CBV",
      "Solicitante: Maria · maria@x.com · 11 99999-0000",
      "Área: Marketing · Polo: Centro",
      "Protocolo: AB12CD34 · Recebida em 16/09/2026",
      "",
      "Qual o formato?",
      "Post 1080x1080",
      "",
      "Prazo",
      "20/09",
    ].join("\n");
    const { container } = render(<TextoFormatado texto={briefing} />);
    const ps = container.querySelectorAll(".texto-formatado > p");
    expect(ps).toHaveLength(3);
    expect(ps[0].querySelectorAll("br")).toHaveLength(3);
    expect(ps[0].textContent).toContain("[Design] Arte do CBV");
    expect(ps[1].innerHTML).toMatch(/Qual o formato\?<br>\s*Post 1080x1080/);
    // Nada virou lista, título ou link quebrado.
    expect(container.querySelector("ul, ol, h3, h4")).toBeNull();
  });

  it("⚠️ HTML escrito à mão aparece como TEXTO", () => {
    const { container } = render(
      <TextoFormatado texto={'<b>oi</b> <script>alert(1)</script> <img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector("b, script, img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("⚠️ javascript: e data: NÃO viram link -- o nome fica como texto", () => {
    const { container } = render(
      <TextoFormatado texto={"[clique](javascript:alert(1)) e [outro](data:text/html,oi)"} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("clique");
  });

  it("⭐ link com nome e URL solta abrem em aba nova, com rel", () => {
    render(<TextoFormatado texto={"[Pasta](https://drive.google.com/x) e https://voleibrasil.media/"} />);
    const pasta = screen.getByRole("link", { name: "Pasta" });
    expect(pasta.getAttribute("href")).toBe("https://drive.google.com/x");
    expect(pasta.getAttribute("target")).toBe("_blank");
    expect(pasta.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "https://voleibrasil.media/" })).toBeTruthy();
  });

  it("negrito, itálico, listas", () => {
    const h = html("**neg** *it*\n\n- a\n- b\n\n1. um\n2. dois");
    expect(h).toContain("<strong>neg</strong>");
    expect(h).toContain("<em>it</em>");
    expect(h).toMatch(/<ul>[\s\S]*<li>a<\/li>/);
    expect(h).toMatch(/<ol>[\s\S]*<li>um<\/li>/);
  });

  it("⚠️ título não compete com a página: # e ## saem como h3, ### como h4", () => {
    const h = html("# Um\n\n## Dois\n\n### Três");
    expect(h).not.toMatch(/<h1|<h2/);
    expect(h).toContain("<h3>Um</h3>");
    expect(h).toContain("<h3>Dois</h3>");
    expect(h).toContain("<h4>Três</h4>");
  });

  it("tabela, imagem, código, citação e risco não viram elemento -- o texto fica", () => {
    const { container } = render(
      <TextoFormatado texto={"| a | b |\n|---|---|\n| 1 | 2 |\n\n![foto](https://x/y.png)\n\n`cod` ~~risco~~\n\n> cita"} />,
    );
    expect(container.querySelector("table, img, code, pre, del, blockquote, hr, input")).toBeNull();
    expect(container.textContent).toContain("cod");
    expect(container.textContent).toContain("risco");
    expect(container.textContent).toContain("cita");
  });
});

function EditorControlado({ inicial }: { inicial: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <span id="rotulo">Descrição</span>
      <EditorDeDescricao valor={valor} onChange={setValor} rotuloId="rotulo" />
    </>
  );
}

describe("EditorDeDescricao", () => {
  function campo() {
    return screen.getByRole("textbox", { name: "Descrição" }) as HTMLTextAreaElement;
  }

  it("⭐ o botão B envolve a SELEÇÃO do campo, e a palavra continua selecionada", () => {
    render(<EditorControlado inicial="um dois três" />);
    campo().setSelectionRange(3, 7);
    fireEvent.click(screen.getByRole("button", { name: "Negrito (Ctrl+B)" }));
    expect(campo().value).toBe("um **dois** três");
    expect([campo().selectionStart, campo().selectionEnd]).toEqual([5, 9]);
    expect(document.activeElement).toBe(campo());
  });

  it("⚠️ o mousedown na barra é cancelado -- o campo não perde a seleção", () => {
    render(<EditorControlado inicial="um dois" />);
    const botao = screen.getByRole("button", { name: "Lista" });
    // `fireEvent` devolve false quando alguém chamou `preventDefault`.
    expect(fireEvent.mouseDown(botao)).toBe(false);
  });

  it("Ctrl+K no campo faz o link, e não chega ao navegador", () => {
    render(<EditorControlado inicial="Pasta" />);
    campo().setSelectionRange(0, 5);
    expect(fireEvent.keyDown(campo(), { key: "k", ctrlKey: true })).toBe(false);
    expect(campo().value).toBe("[Pasta](https://)");
  });

  it("⭐ \"Visualizar\" mostra formatado, sem a barra; \"Escrever\" volta com o texto", () => {
    render(<EditorControlado inicial={"**neg**"} />);
    fireEvent.click(screen.getByRole("tab", { name: "Visualizar" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByText("neg").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("tab", { name: "Escrever" }));
    expect(campo().value).toBe("**neg**");
  });
});
