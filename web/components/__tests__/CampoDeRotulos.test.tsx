/**
 * O campo de categoria e tags do projeto: abre o catálogo do time, escolhe e cria.
 * O caso que importa é criar na escolha única: o editor grava logo após criar,
 * antes de o catálogo novo renderizar, e a categoria criada não pode se perder.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CampoDeRotulos from "@/components/CampoDeRotulos";
import type { ProjectLabel } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, listProjectLabels: vi.fn(), createProjectLabel: vi.fn() };
});

const api = await import("@/lib/api");

const EVENTOS: ProjectLabel = { id: "c1", team_id: "mkt", name: "Eventos", color: "gray" };
const FEIRA: ProjectLabel = { id: "t1", team_id: "mkt", name: "Feira", color: "gray" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("CampoDeRotulos", () => {
  it("busca o catálogo do time do projeto e escolhe a categoria", async () => {
    vi.mocked(api.listProjectLabels).mockResolvedValue([EVENTOS]);
    const onChange = vi.fn();
    render(
      <CampoDeRotulos kind="categories" titulo="Categoria" teamId="seo" valor={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Escolher categoria" }));
    fireEvent.click(await screen.findByRole("option", { name: /Eventos/ }));

    expect(api.listProjectLabels).toHaveBeenCalledWith("categories", "seo");
    expect(onChange).toHaveBeenCalledWith([EVENTOS]);
  });

  it("criar na escolha única já deixa a categoria nova escolhida", async () => {
    vi.mocked(api.listProjectLabels).mockResolvedValue([EVENTOS]);
    const nova: ProjectLabel = { id: "c2", team_id: "mkt", name: "Campanhas", color: "brown" };
    vi.mocked(api.createProjectLabel).mockResolvedValue(nova);
    const onChange = vi.fn();
    render(
      <CampoDeRotulos kind="categories" titulo="Categoria" teamId="mkt" valor={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Escolher categoria" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Buscar ou criar opção" }), {
      target: { value: "Campanhas" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Criar "Campanhas"/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([nova]));
    // A próxima cor livre da paleta: "gray" já está em uso.
    expect(api.createProjectLabel).toHaveBeenCalledWith("categories", {
      team_id: "mkt",
      name: "Campanhas",
      color: "brown",
    });
  });

  it("tags: marca várias e grava ao concluir", async () => {
    vi.mocked(api.listProjectLabels).mockResolvedValue([FEIRA, EVENTOS]);
    const onChange = vi.fn();
    render(<CampoDeRotulos kind="tags" titulo="Tags" teamId="mkt" valor={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher tags" }));
    fireEvent.click(await screen.findByRole("option", { name: /Feira/ }));
    fireEvent.click(screen.getByRole("option", { name: /Eventos/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(onChange).toHaveBeenCalledWith([FEIRA, EVENTOS]);
  });
});
