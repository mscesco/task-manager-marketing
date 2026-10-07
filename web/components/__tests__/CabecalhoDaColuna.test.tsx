// Spec 056, fatia I -- o cabeçalho de coluna como o do Notion.
//
// ⚠️ O QUE ESTE ARQUIVO PRENDE (o pedido dela, 07/10): o cabeçalho INTEIRO é o
// botão, sem "⋯"; o menu traz os itens do Notion que entraram; as setas "›"
// abrem submenu; cada item obedece o SEU cadeado do servidor; e a coluna de
// título não oferece o que não pode (inserir à esquerda, duplicar, ocultar,
// excluir).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CabecalhoDaColuna from "@/components/bases/CabecalhoDaColuna";
import type { BaseColumn } from "@/lib/api";
import { lerConfig } from "@/lib/baseViews";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    updateBaseColumn: vi.fn(),
    createBaseColumn: vi.fn(),
    duplicateBaseColumn: vi.fn(),
    deleteBaseColumn: vi.fn(),
  };
});
const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DATA: BaseColumn = {
  id: "c-data", name: "Data", type: "date", options: [], position: 2, width: null, version: 1,
};
const TITULO: BaseColumn = {
  id: "c-t", name: "Título", type: "title", options: [], position: 1, width: null, version: 1,
};

function montar(coluna: BaseColumn, over: Partial<Parameters<typeof CabecalhoDaColuna>[0]> = {}) {
  const props = {
    baseId: "b1",
    coluna,
    podeEditar: true,
    podeCriar: true,
    podeApagar: true,
    podeEditarVisao: true,
    config: lerConfig({}),
    onConfig: vi.fn(),
    onMudou: vi.fn(),
    onApagou: vi.fn(),
    onCriou: vi.fn(),
    ...over,
  };
  render(<CabecalhoDaColuna {...props} />);
  return props;
}

describe("CabecalhoDaColuna", () => {
  it("⚠️ o cabeçalho inteiro abre o menu -- sem '⋯' -- com o nome editável no topo", () => {
    montar(DATA);
    expect(screen.queryByRole("button", { name: /Opções da coluna/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    expect((screen.getByLabelText("Nome da coluna") as HTMLInputElement).value).toBe("Data");
    for (const item of [
      "Alterar tipo", "Filtrar", "Ordenar", "Congelar", "Ocultar",
      "Inserir à esquerda", "Inserir à direita", "Duplicar propriedade", "Excluir propriedade",
    ]) {
      expect(screen.getByRole("button", { name: item })).toBeTruthy();
    }
  });

  it("Alterar tipo › abre o submenu; escolher pede a confirmação com o aviso", async () => {
    vi.mocked(api.updateBaseColumn).mockResolvedValue({ ...DATA, type: "text" });
    const p = montar(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Alterar tipo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Texto" }));
    expect(screen.getByText(/apaga os valores desta coluna/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trocar tipo" }));
    await waitFor(() =>
      expect(api.updateBaseColumn).toHaveBeenCalledWith("b1", "c-data", { type: "text" })
    );
    expect(p.onMudou).toHaveBeenCalledWith({ ...DATA, type: "text" }, true);
  });

  it("Ordenar › Decrescente e Congelar mudam a visão", async () => {
    const p = montar(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Ordenar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Decrescente" }));
    expect(p.onConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ sorts: [{ column_id: "c-data", direction: "desc" }] })
    );

    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Congelar" }));
    expect(p.onConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ frozen_column: "c-data" })
    );
  });

  it("Inserir à esquerda cria NA posição da coluna; à direita, na seguinte", async () => {
    vi.mocked(api.createBaseColumn).mockResolvedValue({ ...DATA, id: "nova" });
    const p = montar(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Inserir à esquerda" }));
    await waitFor(() =>
      expect(api.createBaseColumn).toHaveBeenCalledWith("b1", { name: "Nova coluna", type: "text", position: 2 })
    );
    expect(p.onCriou).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Inserir à direita" }));
    await waitFor(() =>
      expect(api.createBaseColumn).toHaveBeenLastCalledWith("b1", { name: "Nova coluna", type: "text", position: 3 })
    );
  });

  it("a coluna de título não oferece inserir à esquerda, duplicar, ocultar nem excluir", () => {
    montar(TITULO);
    fireEvent.click(screen.getByRole("button", { name: "Coluna Título, Título" }));
    for (const item of ["Inserir à esquerda", "Duplicar propriedade", "Ocultar", "Excluir propriedade", "Alterar tipo"]) {
      expect(screen.queryByRole("button", { name: item })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Inserir à direita" })).toBeTruthy();
  });

  it("⚠️ cada item segue o seu cadeado: sem can_update_view, nada de filtrar/ordenar/congelar/ocultar", () => {
    montar(DATA, { podeEditarVisao: false });
    fireEvent.click(screen.getByRole("button", { name: "Coluna Data, Data" }));
    for (const item of ["Filtrar", "Ordenar", "Congelar", "Ocultar"]) {
      expect(screen.queryByRole("button", { name: item })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Duplicar propriedade" })).toBeTruthy();
  });

  it("sem nenhum cadeado, o cabeçalho é só o nome", () => {
    montar(DATA, { podeEditar: false, podeCriar: false, podeApagar: false, podeEditarVisao: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Data")).toBeTruthy();
  });
});
