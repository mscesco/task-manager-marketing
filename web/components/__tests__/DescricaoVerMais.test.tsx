// A descrição longa para no "Ver mais" (pedido dela, 30/09).
//
// ⚠️ O DEFEITO QUE ISTO CORRIGE: uma descrição de 40 linhas empurrava links,
// subtarefas e checklist para fora da vista — era preciso rolar a coluna
// inteira para descobrir que a tarefa TEM subtarefas.
//
// ⚠️⚠️ JSDOM NÃO FAZ LAYOUT, e `scrollHeight` é SEMPRE 0 nele. Sem forjar a
// medida, este teste passaria sem nunca exercitar a regra — verde e provando
// nada. Aqui o `scrollHeight` é fingido de propósito, e é isso que torna o
// teste honesto: ele afirma "quando o texto EXCEDE, aparece o botão", e não
// "quando o texto é longo em caracteres".
//
// SABOTAGEM (medida): em `DescricaoEditavel`, trocar o `>` da comparação de
// altura por `<`. Deve cair "só aparece quando excede".

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import DescricaoEditavel from "@/components/DescricaoEditavel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Finge a altura que o jsdom não calcula. */
function comAltura(px: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(px);
}

describe("a dobra da descrição", () => {
  it("só aparece quando excede", () => {
    comAltura(120); // cabe
    render(<DescricaoEditavel valor="curta" onSalvar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ver mais" })).toBeNull();
  });

  it("texto alto ganha o 'Ver mais', e ele abre e fecha", () => {
    comAltura(900); // não cabe
    render(<DescricaoEditavel valor="um texto enorme" onSalvar={vi.fn()} />);

    const verMais = screen.getByRole("button", { name: "Ver mais" });
    expect(verMais.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(verMais);
    const verMenos = screen.getByRole("button", { name: "Ver menos" });
    expect(verMenos.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(verMenos);
    expect(screen.getByRole("button", { name: "Ver mais" })).toBeTruthy();
  });

  it("⚠️ o texto continua INTEIRO no DOM, só escondido", () => {
    // Cortar o texto de verdade tiraria dele a busca do navegador (Ctrl+F) e
    // o leitor de tela — a dobra é visual, não de conteúdo.
    comAltura(900);
    render(
      <DescricaoEditavel valor="o fim do texto está aqui" onSalvar={vi.fn()} />,
    );
    expect(screen.getByText(/o fim do texto está aqui/)).toBeTruthy();
  });

  it("sem descrição, não há dobra nenhuma", () => {
    comAltura(900);
    render(<DescricaoEditavel valor="" onSalvar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ver mais" })).toBeNull();
    expect(screen.getByText("Adicionar uma descrição…")).toBeTruthy();
  });
});
