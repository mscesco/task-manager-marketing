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
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_TEXT,
  DIAS_PARA_PARADA,
  dataHoraBR,
  deadlineLabel,
  paradaLabel,
  deadlineTone,
} from "@/lib/status";
import { diasParadoPorColuna, type Coluna } from "@/lib/coluna";

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
    ...Object.values(DEADLINE_COLOR),
  ];

  it("nenhum hex sobrou -- todo valor e var(--...)", () => {
    for (const v of TODOS) {
      expect(v).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });

  it("nenhuma cor ficou undefined ou string vazia", () => {
    expect(TODOS.length).toBe(8 + 8 + 4 + 2);
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
  });

  it("prioridade tem as 4 chaves, e as mesmas nos dois mapas", () => {
    const esperado = ["HIGH", "LOW", "MEDIUM", "URGENT"];
    expect(Object.keys(PRIORITY_COLOR).sort()).toEqual(esperado);
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual(esperado);
  });
});

// ---------------------------------------------------------------------------
// Spec 031 (C2) -- selo "parada ha X dias".
// Relogio fake ja fixado no beforeEach do topo: 25/06/2026, meio-dia local.
// ---------------------------------------------------------------------------
const H = (dias: number) => new Date(2026, 5, 25 - dias, 9, 0, 0).toISOString();

// ⚠️ ESTES TESTES ERAM DO `diasParado` POR STATUS, que saiu na limpeza de
// codigo morto. A aritmetica e a mesma do `diasParadoPorColuna` (copia
// literal), entao eles passaram a mirar a versao por coluna. Quais colunas
// ganham selo fica com o `paridadeColuna.test.ts` ("o selo de parada sai so nas
// tres colunas de trabalho ativo").
const coluna = (
  semantic: Coluna["semantic"],
  notify_deadline = true,
): Coluna => ({
  id: `col-${semantic}`,
  name: semantic,
  color: "var(--status-progress-dot)",
  position: 0,
  semantic,
  notify_deadline,
  is_default_target: true,
  is_status_bridge: false,
});
const ANDAMENTO = coluna("IN_PROGRESS");

describe("diasParadoPorColuna -- quando NAO ha selo", () => {
  it("sem updated_at", () => {
    expect(diasParadoPorColuna(ANDAMENTO, null, false)).toBeNull();
    expect(diasParadoPorColuna(ANDAMENTO, undefined, false)).toBeNull();
  });
  it("arquivada, mesmo parada ha muito tempo", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(90), true)).toBeNull();
  });
  it("coluna OPEN nao para -- parado la e o estado normal", () => {
    expect(diasParadoPorColuna(coluna("OPEN"), H(90), false)).toBeNull();
  });
  it("coluna sem aviso de prazo nao para (D6) -- o BLOCKED", () => {
    expect(diasParadoPorColuna(coluna("IN_PROGRESS", false), H(90), false)).toBeNull();
  });
  it("colunas terminais nao param", () => {
    expect(diasParadoPorColuna(coluna("DONE"), H(90), false)).toBeNull();
    expect(diasParadoPorColuna(coluna("CANCELLED"), H(90), false)).toBeNull();
  });
  it("data invalida nao vira selo", () => {
    expect(diasParadoPorColuna(ANDAMENTO, "nao-e-data", false)).toBeNull();
  });
});

describe("diasParadoPorColuna -- fronteira do limiar", () => {
  it("um dia ABAIXO do limiar nao mostra", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(DIAS_PARA_PARADA - 1), false)).toBeNull();
  });
  it("exatamente no limiar mostra", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(DIAS_PARA_PARADA), false)).toBe(
      DIAS_PARA_PARADA
    );
  });
  it("um dia ACIMA mostra o numero certo", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(DIAS_PARA_PARADA + 1), false)).toBe(
      DIAS_PARA_PARADA + 1
    );
  });
  it("hoje mesmo nao mostra", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(0), false)).toBeNull();
  });
});

describe("paradaLabel", () => {
  it("usa o numero recebido", () => {
    expect(paradaLabel(7)).toBe("Parada há 7 d");
    expect(paradaLabel(31)).toBe("Parada há 31 d");
  });
});

// =====================================================================
// `dataHoraBR` -- Spec 039, F7.
//
// ⚠️ POR QUE ELE TEM TESTE PROPRIO. Ele existe porque o TOM do prazo lia a
// hora e o TEXTO nao lia: card vermelho com "21/08/2026" e nada explicando o
// vermelho. Mesmo defeito que o `deadlineLabel` levou em 18/08, na outra
// metade da tela.
//
// SABOTAGENS -- ✅ MEDIDAS EM 21/08/2026:
//   A. O `slice(0, 5)` sai. **Cai 1** ("corta os segundos").
//   B. A hora e sempre concatenada (sem o ternario). **Cai 1** ("sem hora, so
//      a data"): sai "19/08/2026 undefined".
//   C. O `T00:00:00` sai. ⚠️ **PASSA VERDE EM BRT e CAI EM UTC** -- e por isso
//      o portao `TZ=UTC npm test` existe. A oeste de Greenwich, `new Date`
//      lendo `YYYY-MM-DD` como UTC volta um dia.
// =====================================================================
describe("dataHoraBR", () => {
  it("sem hora, só a data", () => {
    expect(dataHoraBR("2026-08-19")).toBe("19/08/2026");
    // `null` e `undefined` sao a mesma coisa aqui: a API manda `null`, e quem
    // nao tem o campo nao passa nada.
    expect(dataHoraBR("2026-08-19", null)).toBe("19/08/2026");
  });

  it("⚠️ corta os segundos que o backend manda", () => {
    // O `due_time` volta como `HH:MM:SS`. Sem cortar, a pílula do detalhe
    // dizia "19/08/2026 18:00:00" -- e dizia mesmo, antes da Spec 038 fatia B
    // ganhar o `slice` na mão.
    expect(dataHoraBR("2026-08-19", "18:00:00")).toBe("19/08/2026 18:00");
  });

  it("aceita `HH:MM` já curto, sem estragar", () => {
    // O rascunho do `<input type="time">` vem sem segundos. O mesmo helper
    // atende os dois formatos porque `slice` de string curta é inofensivo.
    expect(dataHoraBR("2026-08-19", "07:05")).toBe("19/08/2026 07:05");
  });

  it("⚠️ meia-noite não anda um dia para trás", () => {
    // Este é o teste que o `TZ=UTC npm test` protege. Sem o `T00:00:00`, em
    // fuso negativo isto vira 31/12/2025.
    expect(dataHoraBR("2026-01-01")).toBe("01/01/2026");
  });
});
