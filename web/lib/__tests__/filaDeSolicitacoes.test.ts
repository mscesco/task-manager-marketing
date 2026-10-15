import { describe, expect, it } from "vitest";

import type { Batch, BatchItem } from "../api";
import { demandaInicial, quandoChegou } from "../filaDeSolicitacoes";

// 15/10/2026 14:00 em Brasília (17:00 UTC).
const AGORA = new Date("2026-10-15T17:00:00Z");

describe("quandoChegou", () => {
  it("hoje mostra a HORA de Brasília", () => {
    expect(quandoChegou("2026-10-15T12:30:00Z", AGORA)).toBe("09:30");
  });

  it("⚠️ 23h de ontem em Brasília é 'Ontem', mesmo já sendo hoje em UTC", () => {
    // 15/10 02:00 UTC = 14/10 23:00 em Brasília.
    expect(quandoChegou("2026-10-15T02:00:00Z", AGORA)).toBe("Ontem");
  });

  it("antes de ontem, a data curta", () => {
    expect(quandoChegou("2026-10-10T15:00:00Z", AGORA)).toBe("10/10");
  });
});

function item(id: string, status: BatchItem["status"]): BatchItem {
  return { id, status } as BatchItem;
}

describe("demandaInicial", () => {
  it("abre na primeira PENDENTE, que é a que pede decisão", () => {
    const envio = { items: [item("a", "APPROVED"), item("b", "PENDING")] } as Batch;
    expect(demandaInicial(envio)).toBe("b");
  });

  it("sem pendente, a primeira do envio", () => {
    const envio = { items: [item("a", "DONE"), item("b", "REJECTED")] } as Batch;
    expect(demandaInicial(envio)).toBe("a");
  });
});
