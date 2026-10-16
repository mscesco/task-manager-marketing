// Spec 058 (15/10) -- exportar o painel: PDF pela impressão, planilha pelo servidor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExportMenu from "@/components/ExportMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExportMenu", () => {
  it("PDF abre a impressão do navegador, depois de fechar o painel", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ExportMenu onSpreadsheet={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
    expect(screen.queryByRole("dialog", { name: "Exportar" })).toBeNull();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("planilha chama o servidor", async () => {
    const onSpreadsheet = vi.fn(async () => {});
    render(<ExportMenu onSpreadsheet={onSpreadsheet} />);
    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Planilha/ }));
    await waitFor(() => expect(onSpreadsheet).toHaveBeenCalledTimes(1));
  });
});
