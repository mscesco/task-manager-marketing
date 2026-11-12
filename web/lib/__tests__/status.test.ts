// Regras de prazo, cores e selo de parada do front.
//
// Relógio fake obrigatório: `deadlineDays` chama `new Date()`. Meio-dia LOCAL
// de propósito (construtor com componentes, não string ISO com Z), para a
// virada de dia não depender do fuso da máquina.
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
import {
  avisaPrazo,
  deadlineTonePorColuna,
  diasParadoPorColuna,
  type Coluna,
} from "@/lib/coluna";

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

describe("deadlineTone: quando NAO alertar", () => {
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

describe("deadlineTone: quando alertar", () => {
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

  // "Aprovação externa" NÃO pausa o prazo: cliente lento não para o
  // cronômetro do time. O backend faz o mesmo; silenciar só no front faria as
  // duas metades divergirem.
  it("EXTERNAL_APPROVAL vencida -> overdue", () => {
    expect(deadlineTone(ONTEM, "EXTERNAL_APPROVAL", false)).toBe("overdue");
  });

  it("EXTERNAL_APPROVAL vencendo -> soon", () => {
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

// Provam que nenhum hex sobrou nos mapas, que todo status/prioridade/prazo
// tem cor e que dot e text são tokens diferentes. NÃO provam que o token
// existe no globals.css, nem nos dois temas: isso se confere à mão.
describe("cores são tokens", () => {
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

  // As cores de apoio (--teal, --violet, --amber) têm contraste de texto, então
  // podem servir de traço e de texto; nas demais, dot cromático != text escuro.
  const APOIO = ["var(--teal)", "var(--violet)", "var(--amber)"];
  it("dot e text sao tokens DIFERENTES, salvo cor de apoio -- se forem iguais, o AA evapora", () => {
    for (const s of STATUSES) {
      if (APOIO.includes(s.color)) {
        expect(STATUS_TEXT[s.key]).toBe(s.color);
      } else {
        expect(STATUS_TEXT[s.key]).not.toBe(s.color);
      }
    }
  });

  it("prioridade tem as 4 chaves, e as mesmas nos dois mapas", () => {
    const esperado = ["HIGH", "LOW", "MEDIUM", "URGENT"];
    expect(Object.keys(PRIORITY_COLOR).sort()).toEqual(esperado);
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual(esperado);
  });
});

// Selo "parada há X dias". Relógio fixado no beforeEach do topo.
const H = (dias: number) => new Date(2026, 5, 25 - dias, 9, 0, 0).toISOString();

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

describe("diasParadoPorColuna: quando NAO ha selo", () => {
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
  it("coluna sem aviso de prazo nao para (o Bloqueado)", () => {
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

describe("diasParadoPorColuna: fronteira do limiar", () => {
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
  it("conta pelo dia LOCAL, nao pelo dia UTC", () => {
    // 22h em São Paulo já é o dia seguinte em UTC: contar pelo dia UTC tira um dia.
    const noite = new Date(2026, 5, 25 - DIAS_PARA_PARADA, 22, 0, 0).toISOString();
    expect(diasParadoPorColuna(ANDAMENTO, noite, false)).toBe(DIAS_PARA_PARADA);
  });
  it("hoje mesmo nao mostra", () => {
    expect(diasParadoPorColuna(ANDAMENTO, H(0), false)).toBeNull();
  });
});

// Colunas criadas por gente: a semântica e a flag combinam de jeitos que o quadro padrão não tem.
describe("avisaPrazo e deadlineTonePorColuna: coluna personalizada", () => {
  it("OPEN com a flag desligada não cobra prazo; ligada, cobra", () => {
    expect(avisaPrazo(coluna("OPEN", false))).toBe(false);
    expect(deadlineTonePorColuna(coluna("OPEN", false), ONTEM, false)).toBeNull();
    expect(avisaPrazo(coluna("OPEN", true))).toBe(true);
    expect(deadlineTonePorColuna(coluna("OPEN", true), ONTEM, false)).toBe("overdue");
  });

  it("terminal com a flag ligada continua sem cobrar", () => {
    for (const semantic of ["DONE", "CANCELLED"] as const) {
      expect(avisaPrazo(coluna(semantic, true))).toBe(false);
      expect(deadlineTonePorColuna(coluna(semantic, true), ONTEM, false)).toBeNull();
    }
  });

  it("com hora, vence hoje e já passou da hora: vermelho", () => {
    // Relógio às 12:00; sem a hora chegar a `estaAtrasada`, sairia "soon".
    expect(deadlineTonePorColuna(ANDAMENTO, HOJE, false, "11:00:00")).toBe("overdue");
    expect(deadlineTonePorColuna(ANDAMENTO, HOJE, false, "13:00:00")).toBe("soon");
    expect(deadlineTonePorColuna(ANDAMENTO, HOJE, false)).toBe("soon");
  });
});

describe("paradaLabel", () => {
  it("usa o numero recebido", () => {
    expect(paradaLabel(7)).toBe("Parada há 7 d");
    expect(paradaLabel(31)).toBe("Parada há 31 d");
  });
});

describe("dataHoraBR", () => {
  it("sem hora, só a data", () => {
    expect(dataHoraBR("2026-08-19")).toBe("19/08/2026");
    // `null` e `undefined` sao a mesma coisa aqui: a API manda `null`, e quem
    // nao tem o campo nao passa nada.
    expect(dataHoraBR("2026-08-19", null)).toBe("19/08/2026");
  });

  it("corta os segundos que o backend manda", () => {
    // O `due_time` volta como `HH:MM:SS`.
    expect(dataHoraBR("2026-08-19", "18:00:00")).toBe("19/08/2026 18:00");
  });

  it("aceita `HH:MM` já curto, sem estragar", () => {
    // O rascunho do `<input type="time">` vem sem segundos. O mesmo helper
    // atende os dois formatos porque `slice` de string curta é inofensivo.
    expect(dataHoraBR("2026-08-19", "07:05")).toBe("19/08/2026 07:05");
  });

  it("meia-noite não anda um dia para trás", () => {
    // Sem o `T00:00:00`, `new Date` lê a data como UTC e, a oeste de
    // Greenwich, isto vira 31/12/2025. Só falha em fuso negativo: por isso o
    // vitest.config fixa `TZ=America/Sao_Paulo`.
    expect(dataHoraBR("2026-01-01")).toBe("01/01/2026");
  });
});
