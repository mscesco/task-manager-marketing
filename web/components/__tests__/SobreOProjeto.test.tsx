// Spec 052, fatia A -- a descrição do projeto com o começo à vista e "Ver mais".
//
// ⚠️ O jsdom NÃO CALCULA LAYOUT: `scrollHeight` e `clientHeight` são sempre 0.
// A medição de "passa do corte" é simulada aqui, sobrescrevendo as duas
// propriedades no protótipo -- o que se testa é a DECISÃO sobre a medida
// (botão aparece ou não, abre e fecha), e não o corte visual, que é CSS e só a
// tela prova.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import SobreOProjeto from "@/components/SobreOProjeto";

const proto = HTMLElement.prototype;
const originais = {
  scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
};

/** Simula a medida do navegador: quanto o texto ocupa x quanto cabe no corte. */
function medida(ocupa: number, cabe: number) {
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => ocupa });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => cabe });
}

afterEach(() => {
  cleanup();
  for (const [nome, desc] of Object.entries(originais)) {
    if (desc) Object.defineProperty(proto, nome, desc);
  }
});

const LONGA =
  "Link da Pasta Principal https://drive.google.com/drive/folders/1X7GB\n" +
  "Objetivo do Projeto\nGestão e execução operacional do patrocínio CBV × UniFECAF.\n" +
  "Escopo e Parâmetros Contratuais\nInvestimento Fixo: R$ 550 mil/ano.";

describe("SobreOProjeto", () => {
  it("⭐ texto que passa do corte mostra o começo e 'Ver mais'", () => {
    medida(300, 96);
    render(<SobreOProjeto texto={LONGA} />);

    const botao = screen.getByRole("button", { name: "Ver mais" });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    // O começo está na tela (o corte é visual, o texto inteiro está no DOM).
    expect(screen.getByText(/Objetivo do Projeto/)).toBeTruthy();
  });

  it("'Ver mais' abre, e o botão vira 'Ver menos' -- e fecha de volta", () => {
    medida(300, 96);
    render(<SobreOProjeto texto={LONGA} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));
    const menos = screen.getByRole("button", { name: "Ver menos" });
    expect(menos.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(menos);
    expect(screen.getByRole("button", { name: "Ver mais" })).toBeTruthy();
  });

  it("⚠️ aberto, o 'Ver menos' NÃO some ao remedir -- sem corte a medida empata", () => {
    medida(300, 96);
    render(<SobreOProjeto texto={LONGA} />);

    // Aberto não há corte: o navegador passa a dizer que tudo cabe. A medida
    // muda ANTES do clique, para a renderização do clique já ler a nova.
    medida(300, 300);
    fireEvent.click(screen.getByRole("button", { name: "Ver mais" }));

    expect(screen.getByRole("button", { name: "Ver menos" })).toBeTruthy();
  });

  it("⚠️ texto que cabe não mostra botão nenhum -- botão que não abre nada é pior", () => {
    medida(40, 96);
    render(<SobreOProjeto texto="Descrição curta." />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Descrição curta.")).toBeTruthy();
  });

  it("links do texto continuam clicáveis, em aba nova", () => {
    medida(300, 96);
    render(<SobreOProjeto texto={LONGA} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://drive.google.com/drive/folders/1X7GB");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("as quebras de linha ficam como foram digitadas", () => {
    medida(300, 96);
    const { container } = render(<SobreOProjeto texto={LONGA} />);
    const corpo = container.querySelector(".whitespace-pre-wrap");
    expect(corpo).not.toBeNull();
    expect(corpo?.textContent).toContain("Objetivo do Projeto\nGestão");
  });
});
