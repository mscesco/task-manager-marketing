// Regras de prazo do front (Spec 023) + trava da Spec 026.
//
// RELOGIO FAKE OBRIGATORIO (Spec 027, D7): `deadlineDays` chama `new Date()`.
// Sem fixar o relogio, este arquivo passaria hoje e quebraria amanha.
// Meio-dia LOCAL de proposito (construtor com componentes, nao string ISO):
// string ISO com Z seria interpretada em UTC e a virada de dia dependeria
// do fuso da maquina.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEADLINE_COLOR,
  DEADLINE_DOT,
  PRIORITY_COLOR,
  PRIORITY_DOT,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_TEXT,
  DIAS_PARA_PARADA,
  plural,
  deadlineLabel,
  diasParado,
  paradaLabel,
  deadlineTone,
  statusPadraoMinhasTarefas,
} from "@/lib/status";

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
// statusPadraoMinhasTarefas -- filtro inicial da tela (29/07)
// -------------------------------------------------------------------
describe("statusPadraoMinhasTarefas", () => {
  it("esconde CONCLUIDO -- a tela responde 'o que tenho pra fazer'", () => {
    expect(statusPadraoMinhasTarefas()).not.toContain("COMPLETED");
  });

  it("mantem CANCELLED ligado -- cancelamento e noticia, conclusao e rotina", () => {
    expect(statusPadraoMinhasTarefas()).toContain("CANCELLED");
  });

  it("mantem todos os status de trabalho em aberto", () => {
    const padrao = statusPadraoMinhasTarefas();
    for (const k of [
      "BACKLOG",
      "PLANNED",
      "IN_PROGRESS",
      "IN_REVIEW",
      "EXTERNAL_APPROVAL",
      "BLOCKED",
    ]) {
      expect(padrao).toContain(k);
    }
  });

  it("esconde exatamente um status -- nao virou lista curta por acidente", () => {
    expect(statusPadraoMinhasTarefas()).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Spec 031 (C1a) -- cor virou token.
//
// O que estes testes conseguem provar: que nenhum hex sobrou nos mapas, que
// todo status/prioridade/prazo tem cor, e que dot e text sao valores
// DIFERENTES (se alguem colar o mesmo token nos dois, o conserto de contraste
// evapora sem nada ficar vermelho).
//
// ⚠️ O QUE ELES NAO PROVAM: que o token existe no globals.css, e muito menos
// que ele existe nos DOIS temas. O vitest.config.ts limita o `include` a
// `lib/**` -- este arquivo nunca e lido pelo runner. Apagar o bloco
// [data-theme="escuro"] inteiro deixa a suite VERDE e a metade escura da
// interface ilegivel. A conferencia e por grep + olho nos dois temas.
// ---------------------------------------------------------------------------
describe("cor virou token (Spec 031)", () => {
  const TODOS = [
    ...STATUSES.map((s) => s.color),
    ...Object.values(STATUS_TEXT),
    ...Object.values(PRIORITY_COLOR),
    ...Object.values(PRIORITY_DOT),
    ...Object.values(DEADLINE_COLOR),
    ...Object.values(DEADLINE_DOT),
  ];

  it("nenhum hex sobrou -- todo valor e var(--...)", () => {
    for (const v of TODOS) {
      expect(v).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });

  it("nenhuma cor ficou undefined ou string vazia", () => {
    expect(TODOS.length).toBe(8 + 8 + 4 + 4 + 2 + 2);
    for (const v of TODOS) expect(v).toBeTruthy();
  });

  it("todo status tem cor de traco E cor de texto", () => {
    for (const s of STATUSES) {
      expect(STATUS_TEXT[s.key]).toBeTruthy();
    }
    // e nao sobrou chave orfa em STATUS_TEXT
    expect(Object.keys(STATUS_TEXT).sort()).toEqual(
      STATUSES.map((s) => s.key).slice().sort()
    );
  });

  it("dot e text sao tokens DIFERENTES -- se forem iguais, o AA evapora", () => {
    for (const s of STATUSES) {
      expect(STATUS_TEXT[s.key]).not.toBe(s.color);
    }
    for (const p of Object.keys(PRIORITY_COLOR)) {
      expect(PRIORITY_COLOR[p]).not.toBe(PRIORITY_DOT[p]);
    }
    for (const t of ["overdue", "soon"] as const) {
      expect(DEADLINE_COLOR[t]).not.toBe(DEADLINE_DOT[t]);
    }
  });

  it("prioridade tem as 4 chaves, e as mesmas nos dois mapas", () => {
    const esperado = ["HIGH", "LOW", "MEDIUM", "URGENT"];
    expect(Object.keys(PRIORITY_COLOR).sort()).toEqual(esperado);
    expect(Object.keys(PRIORITY_DOT).sort()).toEqual(esperado);
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual(esperado);
  });
});

// ---------------------------------------------------------------------------
// Spec 031 (C2) -- selo "parada ha X dias".
// Relogio fake ja fixado no beforeEach do topo: 25/06/2026, meio-dia local.
// ---------------------------------------------------------------------------
const H = (dias: number) => new Date(2026, 5, 25 - dias, 9, 0, 0).toISOString();

describe("diasParado -- quando NAO ha selo", () => {
  it("sem updated_at", () => {
    expect(diasParado(null, "IN_PROGRESS", false)).toBeNull();
    expect(diasParado(undefined, "IN_PROGRESS", false)).toBeNull();
  });
  it("arquivada, mesmo parada ha muito tempo", () => {
    expect(diasParado(H(90), "IN_PROGRESS", true)).toBeNull();
  });
  it("BACKLOG nao para -- parado la e o estado normal", () => {
    expect(diasParado(H(90), "BACKLOG", false)).toBeNull();
  });
  it("BLOCKED nao para (D6) -- bloqueio e estado declarado", () => {
    expect(diasParado(H(90), "BLOCKED", false)).toBeNull();
  });
  it("COMPLETED e CANCELLED nao param", () => {
    expect(diasParado(H(90), "COMPLETED", false)).toBeNull();
    expect(diasParado(H(90), "CANCELLED", false)).toBeNull();
  });
  it("data invalida nao vira selo", () => {
    expect(diasParado("nao-e-data", "IN_PROGRESS", false)).toBeNull();
  });
});

describe("diasParado -- fronteira do limiar", () => {
  it("um dia ABAIXO do limiar nao mostra", () => {
    expect(diasParado(H(DIAS_PARA_PARADA - 1), "IN_PROGRESS", false)).toBeNull();
  });
  it("exatamente no limiar mostra", () => {
    expect(diasParado(H(DIAS_PARA_PARADA), "IN_PROGRESS", false)).toBe(
      DIAS_PARA_PARADA
    );
  });
  it("um dia ACIMA mostra o numero certo", () => {
    expect(diasParado(H(DIAS_PARA_PARADA + 1), "IN_PROGRESS", false)).toBe(
      DIAS_PARA_PARADA + 1
    );
  });
  it("hoje mesmo nao mostra", () => {
    expect(diasParado(H(0), "IN_PROGRESS", false)).toBeNull();
  });
});

describe("diasParado -- os tres status que contam (D6)", () => {
  it("IN_PROGRESS, IN_REVIEW e EXTERNAL_APPROVAL param", () => {
    for (const st of ["IN_PROGRESS", "IN_REVIEW", "EXTERNAL_APPROVAL"]) {
      expect(diasParado(H(12), st, false)).toBe(12);
    }
  });
  it("nenhum outro status para -- lista fechada, nao aberta", () => {
    const param = new Set(["IN_PROGRESS", "IN_REVIEW", "EXTERNAL_APPROVAL"]);
    for (const s of STATUSES) {
      if (param.has(s.key)) continue;
      expect(diasParado(H(12), s.key, false)).toBeNull();
    }
  });
});

describe("paradaLabel", () => {
  it("usa o numero recebido", () => {
    expect(paradaLabel(7)).toBe("Parada há 7 d");
    expect(paradaLabel(31)).toBe("Parada há 31 d");
  });
});

describe("plural (Spec 031, C7)", () => {
  // Nasceu de um bug em producao: a linha de contadores mostrava
  // "1 canceladas" porque o plural estava cravado no template.
  it("um usa SINGULAR", () => {
    expect(plural(1, "cancelada", "canceladas")).toBe("1 cancelada");
  });
  it("zero usa plural", () => {
    expect(plural(0, "cancelada", "canceladas")).toBe("0 canceladas");
  });
  it("mais de um usa plural", () => {
    expect(plural(2, "cancelada", "canceladas")).toBe("2 canceladas");
    expect(plural(41, "concluída", "concluídas")).toBe("41 concluídas");
  });
});
