// =====================================================
// lib/__tests__/erroApi.test.ts -- o parser de erro de `lib/api.ts`
// -----------------------------------------------------
// O QUE ESTES TESTES PROTEGEM, e que nenhum portao pegava:
//
// O envelope de erro DESTE backend e
//     { "error": { "code", "message", "details" }, "request_id": ... }
// (`backend/app/api/errors.py:_error_body`, e os testes de integracao do
// backend afirmam isso -- `test_orfas_por_mudanca_de_vinculo_http_db.py:160`
// le `r.json()["error"]["details"]["acao"]`).
//
// O front lia `data.detail.*` -- a forma PADRAO do FastAPI, que este backend
// NAO usa. Consequencia medida em 10/08/2026:
//   - `ApiError.details` era SEMPRE `undefined`. `TaskModal.tsx:580` le
//     `e.details?.invalid_ids` desde a Spec de assignees e nunca recebeu nada,
//     apesar de o teste do backend (`test_task_create_assignees_http_db.py:213`)
//     existir com o comentario "o front depende de details.invalid_ids";
//   - `ApiError.message` caia no literal `Erro <status>` em toda falha de
//     dominio, entao a frase escrita no backend nunca aparecia na tela.
//
// ⚠️ POR QUE ISTO PASSAVA VERDE ANTES. `tsc` e `next build` nao leem corpo de
// HTTP, e o unico teste que montava um erro (`logout.test.ts:85`) usava
// `{"detail":"nope"}` -- exatamente a forma que o parser antigo entendia, e
// que o backend nao produz. Teste que so exercita a forma certa por acidente
// nao afirma nada sobre a forma real.
//
// SABOTAGEM (executar antes de commitar):
//     Em `lib/api.ts`, trocar a linha
//         const env = data?.error ?? data?.detail ?? data;
//     por
//         const env = data?.detail ?? data;
//     -- ou seja, devolver o comportamento anterior INTEIRO, nao afrouxar.
//     Devem cair `mensagem do backend` e `details estruturado`, e NAO deve
//     cair `422 do proprio FastAPI`, que e a forma antiga e continua coberta.
// =====================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, clearTokens, moveMemberSubteam, setTokens } from "@/lib/api";

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

const mover = () => moveMemberSubteam("u-1", "t-origem", "t-destino");

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

    const erro = await capturar(mover);

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

    const erro = await capturar(mover);

    expect(erro.code).toBe("password_change_required");
  });

  it("le o details estruturado (a lista da E8 da Spec 037)", async () => {
    mockFetchComCorpo(422, {
      error: {
        code: "validation_error",
        message: "Esta pessoa e a unica responsavel por tarefas.",
        details: {
          acao: "move_member_subteam",
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

    const erro = await capturar(mover);

    expect(erro.details?.acao).toBe("move_member_subteam");
    expect(erro.details?.tarefas).toHaveLength(1);
    // Os CAMPOS, e nao o tamanho -- e o que impede a E8 de virar so contagem.
    expect(erro.details?.tarefas[0]).toMatchObject({
      id: "task-1",
      titulo: "Revisar pauta de agosto",
      subtime: "SEO",
      coluna: "Em andamento",
    });
  });

  it("le tambem o details de invalid_ids (TaskModal.tsx:580)", async () => {
    mockFetchComCorpo(422, {
      error: {
        code: "validation_error",
        message: "Responsaveis invalidos.",
        details: { field: "assignees", invalid_ids: ["u-9", "u-10"] },
      },
      request_id: null,
    });

    const erro = await capturar(mover);

    expect(erro.details?.invalid_ids).toEqual(["u-9", "u-10"]);
  });

  it("continua entendendo corpo NAO-JSON (o `data = { detail: text }`)", async () => {
    // 502 do proxy, HTML de erro, timeout do Traefik: o corpo nao e JSON e
    // `_request` embrulha o texto cru em `{ detail: text }` (api.ts:178). O
    // ramo `data?.detail` do encadeamento existe para isto, e por isso ele NAO
    // saiu quando o `data?.error` entrou na frente.
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("Bad Gateway", { status: 502 })
    );
    vi.stubGlobal("fetch", spy);

    const erro = await capturar(mover);

    expect(erro.status).toBe(502);
    expect(erro.message).toBe("Bad Gateway");
  });

  it("cai no literal Erro <status> quando o corpo nao traz mensagem", async () => {
    mockFetchComCorpo(500, {});

    const erro = await capturar(mover);

    expect(erro.message).toBe("Erro 500");
  });
});
