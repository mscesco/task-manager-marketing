// =====================================================
// lib/__tests__/renovarSessao.test.ts -- auditoria de 16/10
// -----------------------------------------------------
// O 401 de uma request dispara o refresh. Antes, QUALQUER falha do refresh
// derrubava a sessão: o 429 do freio (a instituição sai toda por um IP) e o
// 502 do deploy reiniciando a API deslogavam quem estava com a tela aberta,
// com o refresh token ainda válido. Só a RECUSA do servidor encerra a sessão.
// =====================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, getToken, refreshOutcomeOf, setTokens } from "@/lib/api";

beforeEach(() => {
  localStorage.clear();
  setTokens("access-velho", "refresh-valido");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** A request volta 401; o refresh volta `statusDoRefresh`. */
function servidor(statusDoRefresh: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/auth/refresh")
        ? new Response(null, { status: statusDoRefresh })
        : new Response(null, { status: 401 })
    )
  );
}

describe("refreshOutcomeOf", () => {
  it("só a recusa do servidor é sessão morta", () => {
    expect(refreshOutcomeOf(200)).toBe("renewed");
    expect(refreshOutcomeOf(401)).toBe("dead");
    expect(refreshOutcomeOf(422)).toBe("dead");
    expect(refreshOutcomeOf(429)).toBe("unavailable");
    expect(refreshOutcomeOf(502)).toBe("unavailable");
    expect(refreshOutcomeOf(503)).toBe("unavailable");
  });
});

describe("401 com o refresh indisponível", () => {
  it.each([429, 502])("refresh %i: avisa e MANTÉM a sessão", async (status) => {
    servidor(status);
    const erro = await api("/api/v1/tasks").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(503);
    expect(getToken()).toBe("access-velho");
  });

  it("rede caída no refresh: a sessão também fica", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.endsWith("/auth/refresh")) throw new TypeError("Failed to fetch");
        return new Response(null, { status: 401 });
      })
    );
    await expect(api("/api/v1/tasks")).rejects.toMatchObject({ status: 503 });
    expect(getToken()).toBe("access-velho");
  });
});
