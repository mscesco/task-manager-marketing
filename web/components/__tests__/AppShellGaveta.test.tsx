/**
 * Spec 063 -- o menu conforme a largura: gaveta no celular, sobreposto no
 * tablet, e o computador intocado. As faixas em si sao de `lib/sidebar.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import AppShell from "@/components/AppShell";
import { CHAVE_BARRA_ABERTA } from "@/lib/sidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inicio",
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ContextSwitcher", () => ({ default: () => null }));
vi.mock("@/components/TeamParamReader", () => ({ default: () => null }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getToken: () => "t",
  getMe: vi.fn(async () => ({
    id: "u",
    name: "Ana",
    must_change_password: false,
    permissions: [],
    roles: [],
    teams: [],
    org_role: null,
  })),
  listTeamsAll: vi.fn(async () => []),
  getWorkspace: vi.fn(async () => ({ name: "Org" })),
}));

const larguraOriginal = window.innerWidth;

function montar(largura: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
  render(
    <AppShell>
      <p>conteudo</p>
    </AppShell>,
  );
  return screen.findByText("conteudo");
}

const areaDoConteudo = () => screen.getByText("conteudo").closest("main")!.parentElement!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: larguraOriginal });
});

describe("celular", () => {
  it("abre pela barra, prende o foco na gaveta e o Escape devolve ao botao", async () => {
    await montar(375);
    const botao = screen.getByRole("button", { name: "Abrir menu" });
    expect(areaDoConteudo().hasAttribute("inert")).toBe(false);

    fireEvent.click(botao);
    await waitFor(() => expect(areaDoConteudo().hasAttribute("inert")).toBe(true));
    expect(document.activeElement).toBe(screen.getByLabelText("Retrair menu"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(areaDoConteudo().hasAttribute("inert")).toBe(false));
    expect(document.activeElement).toBe(botao);
  });

  it("aberta, a gaveta nao tem `translate`: ele recortaria os paineis `fixed` dela", async () => {
    await montar(375);
    const gaveta = document.querySelector("aside")!;
    expect(gaveta.className).toContain("-translate-x-full");

    fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    await waitFor(() => expect(gaveta.className).not.toMatch(/translate-x/));
  });
});

describe("tablet", () => {
  it("retraido por padrao, expande por cima sem gravar a preferencia do computador", async () => {
    await montar(800);
    expect(screen.queryByRole("button", { name: "Abrir menu" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Expandir menu"));
    await screen.findByLabelText("Retrair menu");
    expect(localStorage.getItem(CHAVE_BARRA_ABERTA)).toBeNull();
  });

  it("sem o botao da barra, o foco volta ao Expandir", async () => {
    await montar(800);
    fireEvent.click(screen.getByLabelText("Expandir menu"));
    await waitFor(() => expect(areaDoConteudo().hasAttribute("inert")).toBe(true));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Expandir menu")));
  });
});

it("computador: sem barra superior, e o Retrair continua gravando", async () => {
  await montar(1280);
  expect(screen.queryByRole("button", { name: "Abrir menu" })).toBeNull();

  fireEvent.click(screen.getByLabelText("Retrair menu"));
  expect(localStorage.getItem(CHAVE_BARRA_ABERTA)).toBe("false");
});
