// =====================================================
// lib/__tests__/logout.test.ts -- Spec 030 (D4), lado do front
// -----------------------------------------------------
// Testa `logout()` de `lib/api.ts`. Cabe no escopo do vitest.config
// (`lib/**`) porque a funcao vive em lib/, nao em componente.
//
// O QUE ESTES TESTES PROTEGEM, e que `tsc` e `next build` NAO pegam:
//   - o Bearer sair vazio (logout vira no-op silencioso -- pior falha
//     possivel: o botao "responde", a sessao continua viva no servidor);
//   - `logout()` lancar e derrubar o `sair()` antes do `router.replace`,
//     prendendo a pessoa numa tela com token ja limpo;
//   - a ORDEM entre ler o token e limpar o localStorage (ver o ultimo teste).
// =====================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTokens, logout, setTokens } from "@/lib/api";

const ACCESS = "access-de-teste";
const REFRESH = "refresh-de-teste";

// Os parametros sao declarados (mesmo sem uso) para o mock.calls ficar
// TIPADO como [string, RequestInit] -- sem isso o `tsc` reprova o cast
// mais adiante, ainda que o vitest passe. Portoes diferentes, erros
// diferentes: `npm test` verde nao dispensa `npx tsc --noEmit`.
function mockFetch() {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 204 })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("logout()", () => {
  it("chama POST /api/v1/auth/logout com o Bearer do access token", async () => {
    setTokens(ACCESS, REFRESH);
    const fetchSpy = mockFetch();

    await logout();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/auth/logout");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS}`
    );
  });

  it("nao chama a rede quando nao ha token", async () => {
    const fetchSpy = mockFetch();

    await logout();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("nao lanca quando a rede falha", async () => {
    setTokens(ACCESS, REFRESH);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    // Se isto lancar, `sair()` para antes do router.replace e a pessoa fica
    // presa numa tela sem token.
    await expect(logout()).resolves.toBeUndefined();
  });

  it("nao lanca quando o servidor recusa (token ja morto)", async () => {
    setTokens(ACCESS, REFRESH);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"detail":"nope"}', { status: 401 }))
    );

    await expect(logout()).resolves.toBeUndefined();
  });

  it("le o token ANTES de qualquer await -- clearTokens() logo depois nao o esvazia", async () => {
    // Este teste reproduz exatamente o que `sair()` faz no AppShell:
    //     void logout();
    //     clearTokens();
    //     router.replace("/login");
    // Se a leitura do token migrar para depois de um await, o header sai
    // vazio e o logout vira no-op sem ninguem perceber.
    setTokens(ACCESS, REFRESH);
    const fetchSpy = mockFetch();

    const emVoo = logout(); // NAO aguardado, igual ao `void logout()`
    clearTokens(); // limpa o localStorage no mesmo tick
    await emVoo;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS}`
    );
  });
});
