/**
 * A aba de chaves de API: criar manda o que a pessoa escolheu, a chave aparece
 * uma vez só, e revogar tira da lista.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChavesDeApi from "@/components/ChavesDeApi";
import type { ApiKey } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, listApiKeys: vi.fn(), createApiKey: vi.fn(), revokeApiKey: vi.fn() };
});

const api = await import("@/lib/api");

const LOOKER: ApiKey = {
  id: "k1",
  name: "Looker",
  prefix: "tm_abcdefg",
  read_only: true,
  expires_at: "2027-02-17T15:00:00Z",
  last_used_at: null,
  created_at: "2026-11-19T15:00:00Z",
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChavesDeApi", () => {
  it("cria com nome, poder e validade, mostra a chave uma vez e põe na lista", async () => {
    vi.mocked(api.listApiKeys).mockResolvedValue([]);
    vi.mocked(api.createApiKey).mockResolvedValue({
      ...LOOKER,
      id: "k2",
      name: "n8n",
      read_only: false,
      expires_at: null,
      key: "tm_segredo_inteiro",
    });
    render(<ChavesDeApi />);

    fireEvent.click(await screen.findByRole("button", { name: "Nova chave" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: " n8n " } });
    fireEvent.click(screen.getByLabelText("Ler e alterar"));
    fireEvent.change(screen.getByLabelText("Validade"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar chave" }));

    await waitFor(() =>
      expect(api.createApiKey).toHaveBeenCalledWith({ name: "n8n", read_only: false, days: null }),
    );
    expect(await screen.findByDisplayValue("tm_segredo_inteiro")).toBeTruthy();
    expect(screen.getByText("Sem validade", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pronto, já guardei" }));
    expect(screen.queryByDisplayValue("tm_segredo_inteiro")).toBeNull();
    expect(screen.getByText("n8n")).toBeTruthy();
  });

  it("sem nome não manda nada", async () => {
    vi.mocked(api.listApiKeys).mockResolvedValue([]);
    render(<ChavesDeApi />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova chave" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar chave" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.createApiKey).not.toHaveBeenCalled();
  });

  it("revogar pergunta e tira da lista", async () => {
    vi.mocked(api.listApiKeys).mockResolvedValue([LOOKER]);
    vi.mocked(api.revokeApiKey).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ChavesDeApi />);

    fireEvent.click(await screen.findByRole("button", { name: "Revogar a chave Looker" }));
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(screen.queryByText("Looker")).toBeNull());
  });
});
