// Spec 057 (15/10) -- o assistente de importação: arquivo, colunas, conferir.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImportWizard from "@/components/bases/ImportWizard";
import type { BaseColumn } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, previewImport: vi.fn(), runImport: vi.fn() };
});
const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TITULO = { id: "c-t", name: "Título", type: "title", options: [], position: 1, width: null, version: 1 } as BaseColumn;
const PLAT = { id: "c-p", name: "Plataforma", type: "select", options: [], position: 2, width: null, version: 1 } as BaseColumn;

describe("ImportWizard", () => {
  it("sugere o destino, confere e importa só as válidas", async () => {
    vi.mocked(api.previewImport).mockResolvedValue({
      sheets: ["CSV"],
      sheet: "CSV",
      header_row: 1,
      total_rows: 3,
      columns: [
        { index: 0, name: "Tarefa", suggested_type: "text", sample: ["Post 1"] },
        { index: 1, name: "Plataforma", suggested_type: "select", sample: ["Instagram"] },
        { index: 2, name: "Alcance", suggested_type: "number", sample: ["10"] },
      ],
    });
    vi.mocked(api.runImport)
      .mockResolvedValueOnce({
        total: 3, valid: 2, error_count: 1, imported: 0, base_id: null,
        errors: [{ line: 4, column: "Alcance", message: "'abc' nao e um numero." }],
      })
      .mockResolvedValueOnce({ total: 3, valid: 2, error_count: 1, imported: 2, base_id: "b1", errors: [] });
    const onDone = vi.fn();
    render(
      <ImportWizard
        target={{ kind: "existing", baseId: "b1", columns: [TITULO, PLAT] }}
        onClose={() => {}}
        onDone={onDone}
      />
    );
    const arquivo = new File(["Tarefa;Plataforma;Alcance"], "posts.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText(/Arquivo/), { target: { files: [arquivo] } });

    // 1ª coluna -> título; a de mesmo nome junta com a existente; o resto, nova
    const destinoTarefa = (await screen.findByLabelText("Destino de Tarefa")) as HTMLSelectElement;
    expect(destinoTarefa.value).toBe("title");
    expect((screen.getByLabelText("Destino de Plataforma") as HTMLSelectElement).value).toBe("existing:c-p");
    expect((screen.getByLabelText("Destino de Alcance") as HTMLSelectElement).value).toBe("new:number");

    fireEvent.click(screen.getByRole("button", { name: "Conferir" }));
    expect(await screen.findByText(/Linha 4/)).toBeTruthy();
    expect(vi.mocked(api.runImport).mock.calls[0][0]).toMatchObject({ dry_run: true, base_id: "b1" });

    fireEvent.click(screen.getByRole("button", { name: "Importar só as 2 válidas" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ imported: 2 })));
    expect(vi.mocked(api.runImport).mock.calls[1][0]).toMatchObject({ dry_run: false, skip_invalid: true });
  });
});
