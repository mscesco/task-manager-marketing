/**
 * A regra de atraso com hora. O caso que mais importa é o do mesmo dia
 * (venceu hoje às 09:00, agora são 18:00): a comparação ingênua só por data
 * erra em silêncio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agoraNoWorkspace, estaAtrasada, type Agora } from "../prazo";
import { deadlineLabel } from "../status";

const agora = (data: string, hora: string): Agora => ({ data, hora });

describe("estaAtrasada: sem hora", () => {
  it("prazo de ONTEM está atrasada", () => {
    expect(estaAtrasada("2026-08-18", null, agora("2026-08-19", "09:00"))).toBe(
      true
    );
  });

  it("prazo de HOJE NÃO está atrasada, mesmo às 23:59", () => {
    // Sem hora, o prazo é o dia inteiro; não é meia-noite.
    expect(estaAtrasada("2026-08-19", null, agora("2026-08-19", "23:59"))).toBe(
      false
    );
  });

  it("prazo futuro não está atrasada", () => {
    expect(estaAtrasada("2026-09-01", null, agora("2026-08-19", "09:00"))).toBe(
      false
    );
  });
});

describe("estaAtrasada: com hora", () => {
  it("venceu HOJE às 09:00 e agora são 18:00 → ATRASADA", () => {
    // Com só `due_date < hoje`, a tarefa nunca ficaria vermelha no dia.
    expect(
      estaAtrasada("2026-08-19", "09:00", agora("2026-08-19", "18:00"))
    ).toBe(true);
  });

  it("vence HOJE às 18:00 e agora são 09:00 → não atrasada", () => {
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "09:00"))
    ).toBe(false);
  });

  it("o minuto EXATO ainda não atrasou", () => {
    // Fronteira: às 18:00 em ponto o prazo é agora, não passado.
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "18:00"))
    ).toBe(false);
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "18:01"))
    ).toBe(true);
  });

  it("aceita a hora COM SEGUNDOS, como o Postgres devolve", () => {
    // Sem cortar, `"18:00:00"` compara como maior que `"18:00"` e a tarefa
    // deixa de atrasar no minuto exato.
    expect(
      estaAtrasada("2026-08-19", "18:00:00", agora("2026-08-19", "18:01"))
    ).toBe(true);
    expect(
      estaAtrasada("2026-08-19", "18:00:00", agora("2026-08-19", "18:00"))
    ).toBe(false);
  });

  it("hora não salva o prazo de ontem", () => {
    expect(
      estaAtrasada("2026-08-18", "23:59", agora("2026-08-19", "00:01"))
    ).toBe(true);
  });
});

describe("estaAtrasada: ausências", () => {
  it("sem prazo nunca atrasa", () => {
    expect(estaAtrasada(null, null, agora("2026-08-19", "09:00"))).toBe(false);
    expect(estaAtrasada(undefined, "18:00", agora("2026-08-19", "09:00"))).toBe(
      false
    );
  });

  it("hora SEM data devolve false, e não explode", () => {
    // O backend recusa esse par com 422; a tela não deve pintar de vermelho
    // um estado que ninguém conserta pela interface.
    expect(estaAtrasada(null, "18:00", agora("2026-08-19", "23:00"))).toBe(
      false
    );
  });
});

describe("agoraNoWorkspace", () => {
  it("lê no fuso de São Paulo, e não no do navegador", () => {
    // 19/08/2026 às 02:00 UTC é ainda 18/08 às 23:00 em São Paulo (UTC-3).
    const a = agoraNoWorkspace(new Date("2026-08-19T02:00:00Z"));
    expect(a.data).toBe("2026-08-18");
    expect(a.hora).toBe("23:00");
  });

  it("formata a data como YYYY-MM-DD, que é o formato que ordena", () => {
    const a = agoraNoWorkspace(new Date("2026-08-19T15:00:00Z"));
    expect(a.data).toBe("2026-08-19");
    expect(a.hora).toBe("12:00");
  });

  it("a hora é 24h, e a meia-noite é 00:00 e não 24:00", () => {
    // `en-GB` com `hour12: false` já devolve `00`, mas alguns ambientes
    // devolvem `24` para meia-noite -- e `"24:00"` ordenaria depois de tudo.
    const a = agoraNoWorkspace(new Date("2026-08-19T03:30:00Z"));
    expect(a.hora).toBe("00:30");
  });
});

describe("deadlineLabel: o rótulo não pode discordar da cor", () => {
  // 15:00 UTC = 12:00 em São Paulo.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hora JÁ PASSADA hoje não diz 'Vence hoje'", () => {
    const rotulo = deadlineLabel("2026-08-19", "09:00");
    expect(rotulo).not.toContain("Vence hoje");
    expect(rotulo).toContain("Venceu");
  });

  it("hora AINDA POR VIR hoje diz que vence hoje, com a hora", () => {
    expect(deadlineLabel("2026-08-19", "18:00")).toBe("Vence hoje às 18:00");
  });

  it("corta os segundos que o Postgres devolve", () => {
    expect(deadlineLabel("2026-08-19", "18:00:00")).toBe("Vence hoje às 18:00");
  });
});

describe("o fuso do ambiente não decide a regra", () => {
  // Entre 00:00 e 03:00 UTC, São Paulo ainda está no dia anterior: uma conta
  // na meia-noite LOCAL de uma máquina em UTC erraria o dia.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("01:00 UTC (= 22:00 de ONTEM em SP): o rótulo de hoje continua sendo de hoje", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T01:00:00Z"));

    const hojeSP = agoraNoWorkspace().data;
    expect(hojeSP).toBe("2026-08-18"); // em SP ainda é dia 18

    expect(deadlineLabel(hojeSP, "23:59")).toBe("Vence hoje às 23:59");
    expect(deadlineLabel(hojeSP)).toBe("Vence hoje");
  });

  it("e o dia SEGUINTE em SP continua sendo amanhã", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T01:00:00Z"));
    expect(deadlineLabel("2026-08-19")).toBe("Vence amanhã");
  });
});
