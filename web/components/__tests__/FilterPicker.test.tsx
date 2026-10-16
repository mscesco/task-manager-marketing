// Spec 058 (14/10) -- o seletor dos filtros da tela inicial, no padrão do de
// responsáveis: botão, painel com busca, "Todos" no topo, escolha única.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FilterPicker from "@/components/FilterPicker";

afterEach(cleanup);

const PESSOAS = [
  { id: "u1", name: "Ana Souza" },
  { id: "u2", name: "João Lima" },
];

function abrir(value: string | null = null) {
  const onChange = vi.fn();
  render(
    <FilterPicker
      label="Pessoa"
      value={value}
      allLabel="Todas as pessoas"
      options={PESSOAS}
      people
      onChange={onChange}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /^Pessoa:/ }));
  return onChange;
}

describe("FilterPicker", () => {
  it("o botão diz o que está escolhido", () => {
    render(
      <FilterPicker label="Pessoa" value="u2" allLabel="Todas" options={PESSOAS} onChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Pessoa: João Lima" })).toBeTruthy();
  });

  it("a busca ignora acento, e escolher devolve o id", () => {
    const onChange = abrir();
    fireEvent.change(screen.getByPlaceholderText("Buscar pessoa…"), { target: { value: "joao" } });
    expect(screen.queryByRole("button", { name: "Ana Souza" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /João Lima/ }));
    expect(onChange).toHaveBeenCalledWith("u2");
  });

  it("'Todas as pessoas' tira o filtro", () => {
    const onChange = abrir("u1");
    fireEvent.click(screen.getByRole("button", { name: /Todas as pessoas/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
