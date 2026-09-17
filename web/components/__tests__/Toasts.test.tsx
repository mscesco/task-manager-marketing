// A pilha de avisos do app (17/09): `AvisosProvider` + `useAvisar`.
//
// ⚠️ O que se prende aqui é o CONTRATO de que as telas dependem:
//   - dentro do provider, `avisar(texto)` põe o texto na tela;
//   - fora dele, `avisar` não estoura -- é o que deixa os testes de componente
//     montarem uma tela sozinha.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AvisosProvider, useAvisar } from "@/components/Toasts";

function Botao({ texto }: { texto: string }) {
  const avisar = useAvisar();
  return (
    <button type="button" onClick={() => avisar(texto)}>
      avisar
    </button>
  );
}

afterEach(() => {
  cleanup();
});

describe("AvisosProvider", () => {
  it("o aviso pedido por um filho aparece na tela", async () => {
    render(
      <AvisosProvider>
        <Botao texto="Salvo." />
      </AvisosProvider>,
    );
    fireEvent.click(screen.getByText("avisar"));
    expect(await screen.findByText("Salvo.")).toBeTruthy();
  });

  it("dispensar tira o aviso", async () => {
    render(
      <AvisosProvider>
        <Botao texto="Some daqui." />
      </AvisosProvider>,
    );
    fireEvent.click(screen.getByText("avisar"));
    await screen.findByText("Some daqui.");
    fireEvent.click(screen.getByLabelText("Dispensar aviso"));
    // A saída é animada: espera o nó sair.
    await expect.poll(() => screen.queryByText("Some daqui.")).toBeNull();
  });

  it("sem provider, avisar não estoura", () => {
    render(<Botao texto="ninguém ouve" />);
    expect(() => fireEvent.click(screen.getByText("avisar"))).not.toThrow();
    expect(screen.queryByText("ninguém ouve")).toBeNull();
  });
});
