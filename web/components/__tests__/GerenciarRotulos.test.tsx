/**
 * O gerenciador de categorias e tags: renomear, trocar a cor e apagar,
 * e o que ele manda para a API em cada gesto.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GerenciarRotulos from "@/components/GerenciarRotulos";
import type { ProjectLabel } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listProjectLabels: vi.fn(),
    updateProjectLabel: vi.fn(),
    deleteProjectLabel: vi.fn(),
  };
});

const api = await import("@/lib/api");

const EVENTOS: ProjectLabel = { id: "c1", team_id: "mkt", name: "Eventos", color: "blue" };
const FEIRA: ProjectLabel = { id: "t1", team_id: "mkt", name: "Feira", color: "gray" };

function montar(usos = new Map<string, number>()) {
  vi.mocked(api.listProjectLabels).mockImplementation(async (kind) =>
    kind === "categories" ? [EVENTOS] : [FEIRA],
  );
  const props = { teamId: "seo", usos, onMudou: vi.fn(), onFechar: vi.fn() };
  render(<GerenciarRotulos {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GerenciarRotulos", () => {
  it("renomeia ao apertar Enter e avisa que mudou", async () => {
    vi.mocked(api.updateProjectLabel).mockResolvedValue({ ...EVENTOS, name: "Eventos 2027" });
    const props = montar();
    const campo = await screen.findByRole("textbox", { name: "Nome da categoria Eventos" });
    fireEvent.change(campo, { target: { value: "  Eventos 2027 " } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateProjectLabel).toHaveBeenCalledWith("categories", "c1", { name: "Eventos 2027" }),
    );
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("Esc desfaz a digitação sem fechar o diálogo", async () => {
    const props = montar();
    const campo = await screen.findByRole("textbox", { name: "Nome da tag Feira" });
    fireEvent.change(campo, { target: { value: "Outra" } });
    fireEvent.keyDown(campo, { key: "Escape" });

    expect((campo as HTMLInputElement).value).toBe("Feira");
    expect(props.onFechar).not.toHaveBeenCalled();
    expect(api.updateProjectLabel).not.toHaveBeenCalled();
  });

  it("troca a cor", async () => {
    vi.mocked(api.updateProjectLabel).mockResolvedValue({ ...FEIRA, color: "red" });
    montar();
    fireEvent.change(await screen.findByRole("combobox", { name: "Cor da tag Feira" }), {
      target: { value: "red" },
    });
    await waitFor(() =>
      expect(api.updateProjectLabel).toHaveBeenCalledWith("tags", "t1", { color: "red" }),
    );
  });

  it("apagar pergunta antes, dizendo quantos projetos ficam sem a categoria", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deleteProjectLabel).mockResolvedValue(undefined);
    montar(new Map([["c1", 3]]));
    fireEvent.click(await screen.findByRole("button", { name: "Apagar a categoria Eventos" }));

    expect(confirmar.mock.calls[0][0]).toContain("3 projetos ficam sem categoria");
    await waitFor(() => expect(api.deleteProjectLabel).toHaveBeenCalledWith("categories", "c1"));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Nome da categoria Eventos" })).toBeNull(),
    );
  });

  it("recusar a confirmação não apaga", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Apagar a tag Feira" }));
    expect(api.deleteProjectLabel).not.toHaveBeenCalled();
  });
});
