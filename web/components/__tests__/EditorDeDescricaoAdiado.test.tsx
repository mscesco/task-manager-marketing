// Spec 052, revisão de 16/09 -- o editor que não baixa NÃO derruba a página.
//
// ⚠️ O CASO: aba aberta desde antes de um deploy pede o pedaço de código com o
// nome antigo; o `import()` rejeita. Sem fronteira de erro, a rejeição subia até
// a raiz e a tela inteira virava "Application error". Aqui o import do editor é
// forçado a falhar, e o que se prende é: o aviso aparece NO CAMPO, e o resto da
// tela continua lá.
//
// ⚠️ O vitest imprime "There was an error when mocking a module" ao rodar este
// arquivo: é a falha SIMULADA do import, que a fronteira captura. Esperado.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/EditorDeDescricao", () => {
  throw new Error("Loading chunk 123 failed");
});

import EditorDeDescricaoAdiado from "@/components/EditorDeDescricaoAdiado";

afterEach(cleanup);

describe("EditorDeDescricaoAdiado", () => {
  it("⚠️⚠️ falha ao baixar o editor: aviso no campo, e a tela continua", async () => {
    // O React registra o erro capturado no console; aqui ele é esperado.
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <h1>Tarefa aberta</h1>
        <EditorDeDescricaoAdiado valor="texto" onChange={() => {}} />
      </div>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Não consegui carregar o editor");
    expect(screen.getByText("Tarefa aberta")).toBeTruthy();
    expect(screen.getByText("Tentar de novo")).toBeTruthy();
    expect(screen.getByText("Recarregar a página")).toBeTruthy();
    silencio.mockRestore();
  });
});
