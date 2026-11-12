// O parser de erro de `lib/api.ts`. O envelope deste backend é
//     { "error": { "code", "message", "details" }, "request_id": ... }
// e não o `{ "detail": ... }` padrão do FastAPI, que só aparece no 422 do
// próprio framework. Ler só `detail` deixa `ApiError.details` sempre
// `undefined` e a mensagem do backend nunca chega à tela.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, clearTokens, removeMemberFromTeam, setTokens } from "@/lib/api";

/** Responde SEMPRE com o corpo dado, no status dado. */
function mockFetchComCorpo(status: number, corpo: unknown) {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Roda a chamada e devolve o ApiError que ela lancou. */
async function capturar(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("a chamada NAO lancou -- o teste nao afirma nada assim");
}

// Qualquer chamada serve de veiculo: o que se testa e o parser de erro, nao a
// rota.
const chamar = () => removeMemberFromTeam("u-1", "t-origem");

beforeEach(() => {
  localStorage.clear();
  setTokens("access-de-teste", "refresh-de-teste");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokens();
  localStorage.clear();
});

describe("parser de erro de lib/api.ts", () => {
  it("le a mensagem do backend no envelope { error: { message } }", async () => {
    mockFetchComCorpo(422, {
      error: {
        code: "validation_error",
        message: "Esta pessoa e a unica responsavel por tarefas.",
        details: {},
      },
      request_id: null,
    });

    const erro = await capturar(chamar);

    expect(erro.status).toBe(422);
    expect(erro.message).toBe(
      "Esta pessoa e a unica responsavel por tarefas."
    );
    // ⚠️ A afirmacao que importa: NAO e o literal de fallback.
    expect(erro.message).not.toBe("Erro 422");
  });

  it("le o code do envelope", async () => {
    mockFetchComCorpo(409, {
      error: {
        code: "password_change_required",
        message: "Troque a senha provisoria.",
        details: {},
      },
      request_id: null,
    });

    const erro = await capturar(chamar);

    expect(erro.code).toBe("password_change_required");
  });

  it("le o details estruturado", async () => {
    mockFetchComCorpo(422, {
      error: {
        code: "validation_error",
        message: "Esta pessoa e a unica responsavel por tarefas.",
        details: {
          acao: "remove_member_from_team",
          user_id: "u-1",
          tarefas: [
            {
              id: "task-1",
              titulo: "Revisar pauta de agosto",
              subtime: "SEO",
              coluna: "Em andamento",
              team_id: "t-origem",
            },
          ],
        },
      },
      request_id: null,
    });

    const erro = await capturar(chamar);

    expect(erro.details?.acao).toBe("remove_member_from_team");
    expect(erro.details?.tarefas).toHaveLength(1);
    // Os CAMPOS, e nao o tamanho.
    expect(erro.details?.tarefas[0]).toMatchObject({
      id: "task-1",
      titulo: "Revisar pauta de agosto",
      subtime: "SEO",
      coluna: "Em andamento",
    });
  });

  it("le tambem o details de invalid_ids, que o TaskModal le", async () => {
    mockFetchComCorpo(422, {
      error: {
        code: "validation_error",
        message: "Responsaveis invalidos.",
        details: { field: "assignees", invalid_ids: ["u-9", "u-10"] },
      },
      request_id: null,
    });

    const erro = await capturar(chamar);

    expect(erro.details?.invalid_ids).toEqual(["u-9", "u-10"]);
  });

  it("continua entendendo corpo NAO-JSON (o `data = { detail: text }`)", async () => {
    // 502 do proxy, HTML de erro, timeout do Traefik: o corpo nao e JSON e
    // `_request` embrulha o texto cru em `{ detail: text }`. O ramo
    // `data?.detail` do encadeamento existe para isto.
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("Bad Gateway", { status: 502 })
    );
    vi.stubGlobal("fetch", spy);

    const erro = await capturar(chamar);

    expect(erro.status).toBe(502);
    expect(erro.message).toBe("Bad Gateway");
  });

  it("cai no literal Erro <status> quando o corpo nao traz mensagem", async () => {
    mockFetchComCorpo(500, {});

    const erro = await capturar(chamar);

    expect(erro.message).toBe("Erro 500");
  });
});
