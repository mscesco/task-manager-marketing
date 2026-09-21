// Revisão de títulos (21/09) -- renomear a organização, AO LADO do `<h1>`.
//
// O que se prende aqui:
//   - ⚠️ o `<h1>` se chama só pelo nome -- o lápis não empresta o rótulo dele;
//   - ⚠️ o campo e os botões de renomear ficam FORA do `<h1>`;
//   - ✓ e ✕ têm nome (eram só ícone, sem nome nenhum);
//   - Enter salva, Esc desiste, vazio não salva, erro 403 vira frase.
//
// SABOTAGEM (medida): em `PageHeader`, desenhar `{titleAddon}` DENTRO do
// `<PageTitle>`. Deve cair "⚠️ o h1 se chama só pelo nome da organização".

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import PageHeader from "@/components/PageHeader";
import RenameOrganization from "@/components/RenameOrganization";
import { ApiError } from "@/lib/api";

afterEach(() => cleanup());

/** A página em miniatura: o mesmo arranjo de `/organizacao`. */
function Cabecalho({ onRename = vi.fn().mockResolvedValue(undefined) }) {
  const [editando, setEditando] = useState(false);
  const nome = "UniFECAF";
  return (
    <PageHeader
      title={editando ? <span className="sr-only">{nome}</span> : nome}
      titleAddon={
        <RenameOrganization
          name={nome}
          editing={editando}
          onEditingChange={setEditando}
          onRename={onRename}
        />
      }
    />
  );
}

describe("o título de /organizacao", () => {
  it("⚠️ o h1 se chama só pelo nome da organização", () => {
    render(<Cabecalho />);
    expect(screen.getByRole("heading", { level: 1, name: "UniFECAF" })).toBeTruthy();
    // o lápis existe, mas fora do título
    const lapis = screen.getByRole("button", { name: "Renomear a organização" });
    expect(screen.getByRole("heading", { level: 1 }).contains(lapis)).toBe(false);
  });

  it("⚠️ editando, o campo fica fora do h1 -- e o h1 continua lá", () => {
    render(<Cabecalho />);
    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    const titulo = screen.getByRole("heading", { level: 1, name: "UniFECAF" });
    expect(titulo.contains(screen.getByLabelText("Nome da organização"))).toBe(false);
  });

  it("✓ e ✕ têm nome", () => {
    render(<Cabecalho />);
    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    expect(screen.getByRole("button", { name: "Salvar o nome" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });
});

describe("renomear", () => {
  it("Enter salva o nome novo, sem espaços nas pontas", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<Cabecalho onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    const campo = screen.getByLabelText("Nome da organização");
    fireEvent.change(campo, { target: { value: "  FECAF  " } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("FECAF"));
  });

  it("Esc desiste, e vazio não salva", () => {
    const onRename = vi.fn();
    render(<Cabecalho onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    fireEvent.change(screen.getByLabelText("Nome da organização"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o nome" }));
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    fireEvent.keyDown(screen.getByLabelText("Nome da organização"), { key: "Escape" });
    expect(screen.queryByLabelText("Nome da organização")).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("403 vira a frase de permissão, e o campo fica aberto", async () => {
    const onRename = vi.fn().mockRejectedValue(new ApiError(403, "forbidden"));
    render(<Cabecalho onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Renomear a organização" }));
    fireEvent.change(screen.getByLabelText("Nome da organização"), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o nome" }));
    expect(
      await screen.findByText("Só quem administra a organização pode renomeá-la."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Nome da organização")).toBeTruthy();
  });
});
