// Spec 056, fatia H -- o Ctrl+Z da Base, ligado à tecla.
//
// ⚠️ O QUE ESTE ARQUIVO PRENDE: o atalho chama o servidor e recarrega quando
// desfez; DENTRO DE UM CAMPO o Ctrl+Z é do texto e a base não é tocada (§9.4);
// segurar a tecla não dispara dez pedidos; e o que está para gravar (a visão,
// com 600 ms de atraso) grava ANTES -- senão o Ctrl+Z desfaria a ação anterior.
// Quando o atalho vale e o texto do aviso: `lib/__tests__/baseDesfazer.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";

import { useDesfazer } from "@/components/bases/useDesfazer";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, undoBase: vi.fn(), redoBase: vi.fn() };
});
const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("useDesfazer", () => {
  it("Ctrl+Z desfaz e recarrega; Ctrl+Shift+Z refaz", async () => {
    vi.mocked(api.undoBase).mockResolvedValue({ applied: true, conflict: false, kind: "cell.update" });
    vi.mocked(api.redoBase).mockResolvedValue({ applied: true, conflict: false, kind: "cell.update" });
    const aoAplicar = vi.fn();
    renderHook(() => useDesfazer("b1", aoAplicar));

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(aoAplicar).toHaveBeenCalledTimes(1));
    expect(api.undoBase).toHaveBeenCalledWith("b1");

    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api.redoBase).toHaveBeenCalledWith("b1"));
  });

  it("⚠️ dentro de um campo de texto o Ctrl+Z é do texto -- a base não é tocada", async () => {
    vi.mocked(api.undoBase).mockResolvedValue({ applied: false, conflict: false, kind: null });
    const campo = document.createElement("input");
    document.body.appendChild(campo);
    renderHook(() => useDesfazer("b1", vi.fn()));
    fireEvent.keyDown(campo, { key: "z", ctrlKey: true });
    // ⚠️ ESPERA ANTES DE AFIRMAR: o hook grava o pendente (`antes`) e SÓ ENTÃO
    // chama o servidor. Afirmando na mesma volta, este teste passou verde com
    // a regra do campo desligada (sabotagem de 07/10).
    await new Promise((r) => setTimeout(r, 50));
    expect(api.undoBase).not.toHaveBeenCalled();
  });

  it("conflito não recarrega (nada mudou na base)", async () => {
    vi.mocked(api.undoBase).mockResolvedValue({ applied: false, conflict: true, kind: "cell.update" });
    const aoAplicar = vi.fn();
    renderHook(() => useDesfazer("b1", aoAplicar));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(api.undoBase).toHaveBeenCalled());
    expect(aoAplicar).not.toHaveBeenCalled();
  });

  it("segurar a tecla dispara UM pedido por vez", async () => {
    let soltar!: () => void;
    vi.mocked(api.undoBase).mockReturnValue(
      new Promise((r) => {
        soltar = () => r({ applied: true, conflict: false, kind: "cell.update" });
      })
    );
    renderHook(() => useDesfazer("b1", vi.fn()));
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(api.undoBase).toHaveBeenCalledTimes(1));
    soltar();
  });

  it("grava o que está pendente ANTES de desfazer", async () => {
    const ordem: string[] = [];
    vi.mocked(api.undoBase).mockImplementation(async () => {
      ordem.push("undo");
      return { applied: false, conflict: false, kind: null };
    });
    const antes = vi.fn(async () => {
      ordem.push("gravou a visão");
    });
    renderHook(() => useDesfazer("b1", vi.fn(), antes));
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(ordem).toEqual(["gravou a visão", "undo"]));
  });
});
