// Regras de prazo do front (Spec 023) + trava da Spec 026.
//
// RELOGIO FAKE OBRIGATORIO (Spec 027, D7): `deadlineDays` chama `new Date()`.
// Sem fixar o relogio, este arquivo passaria hoje e quebraria amanha.
// Meio-dia LOCAL de proposito (construtor com componentes, nao string ISO):
// string ISO com Z seria interpretada em UTC e a virada de dia dependeria
// do fuso da maquina.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deadlineLabel, deadlineTone, prioridadeEmDestaque } from "@/lib/status";

const HOJE = "2026-06-25";
const ONTEM = "2026-06-24";
const ANTEONTEM = "2026-06-23";
const AMANHA = "2026-06-26";
const EM_2_DIAS = "2026-06-27";
const EM_3_DIAS = "2026-06-28";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 25, 12, 0, 0)); // 25/06/2026, meio-dia local
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deadlineTone -- quando NAO alertar", () => {
  it("sem prazo definido", () => {
    expect(deadlineTone(null, "IN_PROGRESS", false)).toBeNull();
    expect(deadlineTone(undefined, "IN_PROGRESS", false)).toBeNull();
  });

  it("tarefa arquivada, mesmo vencida", () => {
    expect(deadlineTone(ONTEM, "IN_PROGRESS", true)).toBeNull();
  });

  it.each(["COMPLETED", "CANCELLED", "BLOCKED"])(
    "status %s nao alerta (espelha _STATUS_SEM_AVISO do backend)",
    (status) => {
      expect(deadlineTone(ONTEM, status, false)).toBeNull();
    }
  );

  it("prazo distante (3 dias) nao alerta", () => {
    expect(deadlineTone(EM_3_DIAS, "IN_PROGRESS", false)).toBeNull();
  });
});

describe("deadlineTone -- quando alertar", () => {
  it("vencida -> overdue", () => {
    expect(deadlineTone(ONTEM, "IN_PROGRESS", false)).toBe("overdue");
  });

  it.each([HOJE, AMANHA, EM_2_DIAS])("vence em ate 2 dias (%s) -> soon", (d) => {
    expect(deadlineTone(d, "IN_PROGRESS", false)).toBe("soon");
  });

  it.each(["BACKLOG", "PLANNED", "IN_PROGRESS", "IN_REVIEW"])(
    "status aberto %s alerta normalmente",
    (status) => {
      expect(deadlineTone(ONTEM, status, false)).toBe("overdue");
    }
  );

  // --- TRAVA DA SPEC 026 (D5) -----------------------------------------
  // "Aprovacao externa" NAO pausa o prazo: cliente lento nao para o
  // cronometro do time. O backend ja garante isso (EXTERNAL_APPROVAL fora
  // de _STATUS_SEM_AVISO, com teste de integracao). Se alguem silenciar o
  // status SO no front, as duas metades divergem em silencio -- e este
  // teste e o que grita.
  it("EXTERNAL_APPROVAL vencida -> overdue (Spec 026, D5)", () => {
    expect(deadlineTone(ONTEM, "EXTERNAL_APPROVAL", false)).toBe("overdue");
  });

  it("EXTERNAL_APPROVAL vencendo -> soon (Spec 026, D5)", () => {
    expect(deadlineTone(AMANHA, "EXTERNAL_APPROVAL", false)).toBe("soon");
  });
});

describe("deadlineLabel", () => {
  it("singular no primeiro dia de atraso", () => {
    expect(deadlineLabel(ONTEM)).toBe("Atrasada 1 dia");
  });

  it("plural a partir do segundo", () => {
    expect(deadlineLabel(ANTEONTEM)).toBe("Atrasada 2 dias");
  });

  it("vence hoje", () => {
    expect(deadlineLabel(HOJE)).toBe("Vence hoje");
  });

  it("vence amanha", () => {
    expect(deadlineLabel(AMANHA)).toBe("Vence amanhã");
  });

  it("vence em N dias", () => {
    expect(deadlineLabel(EM_2_DIAS)).toBe("Vence em 2 dias");
  });
});

// -------------------------------------------------------------------
// prioridadeEmDestaque -- selo de urgencia na linha de subtarefa (29/07)
// -------------------------------------------------------------------
describe("prioridadeEmDestaque", () => {
  it("destaca ALTA e URGENTE -- o que a equipe chamou de urgencia", () => {
    expect(prioridadeEmDestaque("HIGH")).toBe(true);
    expect(prioridadeEmDestaque("URGENT")).toBe(true);
  });

  it("NAO destaca baixa nem media -- seriam ruido em 11 linhas", () => {
    expect(prioridadeEmDestaque("LOW")).toBe(false);
    expect(prioridadeEmDestaque("MEDIUM")).toBe(false);
  });

  it("aguenta valor ausente ou desconhecido sem quebrar a linha", () => {
    expect(prioridadeEmDestaque(null)).toBe(false);
    expect(prioridadeEmDestaque(undefined)).toBe(false);
    expect(prioridadeEmDestaque("")).toBe(false);
    expect(prioridadeEmDestaque("SEI_LA")).toBe(false);
  });
});
