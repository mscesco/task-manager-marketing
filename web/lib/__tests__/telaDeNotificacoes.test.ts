// lib/__tests__/telaDeNotificacoes.test.ts -- Spec 053, fatia F
//
// SABOTAGENS (medidas):
//   A. Em `agruparPorDia`, trocar `diaNoWorkspace(...)` por `.slice(0, 10)` do
//      ISO cru. Deve cair "⚠️ aviso das 23h de Brasilia fica no dia de Brasilia".
//   B. Em `filtroDaApi`, esquecer o `project_id`. Deve cair "o filtro da API
//      traduz tipo e alvo".

import { describe, expect, it } from "vitest";

import type { AppNotification } from "@/lib/api";
import {
  agruparPorDia,
  ESTADO_INICIAL,
  filtroDaApi,
  lerEstado,
  queryDoEstado,
  rotuloDoBotaoMarcar,
  temFiltro,
} from "@/lib/telaDeNotificacoes";

function aviso(id: string, updated_at: string): AppNotification {
  return {
    id,
    type: "TASK_COMMENTED",
    actor_id: null,
    task_id: null,
    comment_id: null,
    payload: null,
    read_at: null,
    created_at: updated_at,
    updated_at,
  };
}

describe("estado na URL", () => {
  it("URL vazia e o estado inicial, e o inicial nao suja a URL", () => {
    expect(lerEstado("")).toEqual(ESTADO_INICIAL);
    expect(queryDoEstado(ESTADO_INICIAL)).toBe("");
  });

  it("ida e volta preserva tudo", () => {
    const e = {
      aba: "todas" as const,
      tipo: "prazos",
      alvo: { kind: "project" as const, id: "p-1", nome: "Campanha de Matrícula" },
      pagina: 3,
    };
    expect(lerEstado(queryDoEstado(e))).toEqual(e);
  });

  it("⚠️ valor desconhecido cai no padrao", () => {
    expect(lerEstado("?aba=lixo&tipo=lixo&pagina=-4")).toEqual(ESTADO_INICIAL);
  });
});

describe("filtroDaApi e temFiltro", () => {
  it("o filtro da API traduz tipo e alvo", () => {
    expect(
      filtroDaApi({
        ...ESTADO_INICIAL,
        tipo: "prazos",
        alvo: { kind: "project", id: "p-1", nome: "" },
      }),
    ).toEqual({
      types: ["TASK_DUE_CHANGED", "TASK_DUE_SOON", "TASK_OVERDUE"],
      task_id: null,
      project_id: "p-1",
    });
  });

  it("a aba sozinha nao conta como filtro", () => {
    expect(temFiltro({ ...ESTADO_INICIAL, aba: "todas" })).toBe(false);
    expect(temFiltro({ ...ESTADO_INICIAL, tipo: "mencoes" })).toBe(true);
  });
});

describe("rotuloDoBotaoMarcar", () => {
  it("sem filtro marca todas; com filtro diz quantas", () => {
    expect(rotuloDoBotaoMarcar(false, 12)).toBe("Marcar todas como lidas");
    expect(rotuloDoBotaoMarcar(true, 3)).toBe("Marcar estas 3 como lidas");
    expect(rotuloDoBotaoMarcar(true, 1)).toBe("Marcar esta 1 como lida");
  });
});

describe("agruparPorDia", () => {
  const AGORA = { data: "2026-09-17", hora: "10:00" };

  it("Hoje, Ontem, DD/MM e o ano quando muda", () => {
    const grupos = agruparPorDia(
      [
        aviso("a", "2026-09-17T12:00:00Z"),
        aviso("b", "2026-09-17T11:00:00Z"),
        aviso("c", "2026-09-16T12:00:00Z"),
        aviso("d", "2026-09-10T12:00:00Z"),
        aviso("e", "2025-12-31T15:00:00Z"),
      ],
      AGORA,
    );
    expect(grupos.map((g) => [g.rotulo, g.itens.map((n) => n.id)])).toEqual([
      ["Hoje", ["a", "b"]],
      ["Ontem", ["c"]],
      ["10/09", ["d"]],
      ["31/12/2025", ["e"]],
    ]);
  });

  it("⚠️ aviso das 23h de Brasilia fica no dia de Brasilia", () => {
    // 23:30 em Brasilia de 16/09 = 02:30 UTC de 17/09.
    const grupos = agruparPorDia([aviso("x", "2026-09-17T02:30:00Z")], AGORA);
    expect(grupos[0].rotulo).toBe("Ontem");
  });

  it("Ontem atravessa a virada de mes", () => {
    const grupos = agruparPorDia([aviso("x", "2026-08-31T15:00:00Z")], {
      data: "2026-09-01",
      hora: "10:00",
    });
    expect(grupos[0].rotulo).toBe("Ontem");
  });
});
