// Spec 056, fatia G -- o hook do canal ao vivo, com o canal SIMULADO.
//
// ⚠️ O QUE ESTE ARQUIVO PRENDE: aviso de OUTRA pessoa recarrega (uma vez, por
// mais avisos que cheguem juntos); o ECO da própria ação não; o canal que vence
// (`end`) recarrega e reabre. Que o aviso chega de verdade, entre workers, é
// do `backend/tests/integration/test_base_ao_vivo_db.py`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import { useAoVivo } from "@/components/bases/useAoVivo";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, abrirCanalDaBase: vi.fn() };
});
const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Um canal que entrega `pedacos` e então fica aberto (não termina). */
function canal(pedacos: string[], termina = false): Response {
  const cod = new TextEncoder();
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pedacos) c.enqueue(cod.encode(p));
      if (termina) c.close();
    },
  });
  return new Response(corpo, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const aviso = (actor: string) =>
  `data: ${JSON.stringify({ base_id: "b1", kind: "cell.update", actor_id: actor })}\n\n`;

describe("useAoVivo", () => {
  it("conecta no `ready`, e avisos de OUTRA pessoa viram UMA recarga", async () => {
    vi.mocked(api.abrirCanalDaBase).mockResolvedValue(
      canal(["event: ready\ndata: {}\n\n", aviso("bruno"), aviso("bia")])
    );
    const aoMudar = vi.fn();
    const { result } = renderHook(() => useAoVivo("b1", "ana", aoMudar));
    await waitFor(() => expect(result.current).toBe(true));
    await waitFor(() => expect(aoMudar).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("o ECO da própria ação não recarrega", async () => {
    vi.mocked(api.abrirCanalDaBase).mockResolvedValue(
      canal(["event: ready\ndata: {}\n\n", aviso("ana")])
    );
    const aoMudar = vi.fn();
    const { result } = renderHook(() => useAoVivo("b1", "ana", aoMudar));
    await waitFor(() => expect(result.current).toBe(true));
    await new Promise((r) => setTimeout(r, 400));
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("o canal que vence recarrega e REABRE", async () => {
    vi.mocked(api.abrirCanalDaBase)
      .mockResolvedValueOnce(canal(["event: ready\ndata: {}\n\n", "event: end\ndata: {}\n\n"], true))
      .mockResolvedValue(canal(["event: ready\ndata: {}\n\n"]));
    const aoMudar = vi.fn();
    renderHook(() => useAoVivo("b1", "ana", aoMudar));
    await waitFor(() => expect(api.abrirCanalDaBase).toHaveBeenCalledTimes(2));
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });
});
