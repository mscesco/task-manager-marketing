/**
 * Paridade: as regras por COLUNA respondem igual às regras por STATUS nas 8
 * colunas padrão. Sai junto com `deadlineTone` por status quando a última
 * chamada (em `components/TaskDetail.tsx`) migrar para `deadlineTonePorColuna`.
 *
 * Não prova nada sobre coluna criada por gente: ali as regras por status não
 * servem de referência.
 *
 * Relógio fake: `deadlineDays` e `diasParadoPorColuna` chamam `new Date()`.
 * Meio-dia LOCAL de propósito, para a virada de dia não depender do fuso.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deadlineTone } from "@/lib/status";
import {
  colunasPadraoMinhasTarefas,
  deadlineTonePorColuna,
  diasParadoPorColuna,
  type Coluna,
} from "@/lib/coluna";

const HOJE = "2026-06-25";
const ONTEM = "2026-06-24";
const DAQUI_A_MUITO = "2026-12-31";
const PARADA_HA_MUITO = "2026-06-01T12:00:00Z"; // 24 dias antes de HOJE

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 25, 12, 0, 0)); // 25/06/2026, meio-dia LOCAL
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * As 8 colunas que todo quadro recebe ao nascer, copiadas à mão de
 * `backend/app/modules/tasks/domain/board_defaults.py`: nenhum portão liga as
 * duas, e se divergirem este arquivo prova paridade com um mundo que não existe.
 *
 * Bloqueado tem semântica `IN_PROGRESS` com `notify_deadline: false`: a única
 * coluna em que a semântica sozinha daria a resposta errada.
 */
const PADRAO: ReadonlyArray<{ status: string; coluna: Coluna }> = [
  {
    status: "BACKLOG",
    coluna: c("col-backlog", "Backlog", "OPEN", true, 0),
  },
  {
    status: "PLANNED",
    coluna: c("col-planned", "Planejado", "OPEN", true, 1),
  },
  {
    status: "IN_PROGRESS",
    coluna: c("col-progress", "Em Andamento", "IN_PROGRESS", true, 2),
  },
  {
    status: "IN_REVIEW",
    coluna: c("col-review", "Aprovação Interna", "IN_PROGRESS", true, 3),
  },
  {
    status: "EXTERNAL_APPROVAL",
    coluna: c("col-external", "Aprovação Externa", "IN_PROGRESS", true, 4),
  },
  {
    status: "COMPLETED",
    coluna: c("col-done", "Concluído", "DONE", true, 5),
  },
  {
    status: "CANCELLED",
    coluna: c("col-cancel", "Cancelado", "CANCELLED", true, 6),
  },
  {
    status: "BLOCKED",
    coluna: c("col-blocked", "Bloqueado", "IN_PROGRESS", false, 7),
  },
];

function c(
  id: string,
  name: string,
  semantic: Coluna["semantic"],
  notify_deadline: boolean,
  position: number
): Coluna {
  return {
    id,
    name,
    color: "var(--status-backlog-dot)",
    position,
    semantic,
    notify_deadline,
    is_default_target: true,
    is_status_bridge: false,
  };
}

// ---------------------------------------------------------------------------

describe("deadlineTone — paridade caso a caso", () => {
  // Três prazos, não um. Um prazo só provaria a paridade em UM ramo da
  // função; o silenciamento por coluna terminal só aparece com prazo vencido,
  // e o `null` "sem alerta" só aparece com prazo distante.
  for (const { status, coluna } of PADRAO) {
    it(`${status}: vencido responde igual`, () => {
      expect(deadlineTonePorColuna(coluna, ONTEM, false)).toBe(
        deadlineTone(ONTEM, status, false)
      );
    });

    it(`${status}: vence hoje responde igual`, () => {
      expect(deadlineTonePorColuna(coluna, HOJE, false)).toBe(
        deadlineTone(HOJE, status, false)
      );
    });

    it(`${status}: prazo distante responde igual`, () => {
      expect(deadlineTonePorColuna(coluna, DAQUI_A_MUITO, false)).toBe(
        deadlineTone(DAQUI_A_MUITO, status, false)
      );
    });

    it(`${status}: arquivada responde igual`, () => {
      expect(deadlineTonePorColuna(coluna, ONTEM, true)).toBe(
        deadlineTone(ONTEM, status, true)
      );
    });
  }
});

// ---------------------------------------------------------------------------

describe("o filtro padrão de /minhas-tarefas", () => {
  it("esconde só Concluído, como o padrão por status escondia", () => {
    // Compara CONJUNTOS de `id` de coluna.
    const esperado = PADRAO.filter((p) => p.status !== "COMPLETED").map(
      (p) => p.coluna.id
    );
    const obtido = colunasPadraoMinhasTarefas(PADRAO.map((p) => p.coluna));

    expect(obtido.sort()).toEqual(esperado.sort());
  });

  it("Cancelado CONTINUA aparecendo", () => {
    // `CANCELLED` também é terminal, mas esconder as duas é decisão de
    // produto, não refatoração.
    const ligadas = colunasPadraoMinhasTarefas(PADRAO.map((p) => p.coluna));
    expect(ligadas).toContain("col-cancel");
    expect(ligadas).not.toContain("col-done");
  });
});

// ---------------------------------------------------------------------------

describe("controle — a paridade não passa por vacuidade", () => {
  // Se as duas implementações devolvessem `null` sempre, a paridade passaria
  // sem provar nada. Estes afirmam que há sinal de verdade.
  it("alguma coluna padrão realmente alerta prazo vencido", () => {
    const alertam = PADRAO.filter(
      (p) => deadlineTonePorColuna(p.coluna, ONTEM, false) === "overdue"
    );
    expect(alertam.length).toBeGreaterThan(0);
  });

  it("alguma coluna padrão realmente silencia prazo vencido", () => {
    const silenciam = PADRAO.filter(
      (p) => deadlineTonePorColuna(p.coluna, ONTEM, false) === null
    );
    // COMPLETED, CANCELLED e BLOCKED — os três, e só eles.
    expect(silenciam.map((p) => p.status).sort()).toEqual(
      ["BLOCKED", "CANCELLED", "COMPLETED"].sort()
    );
  });

  it("o selo de parada sai só nas três colunas de trabalho ativo", () => {
    // `semantic === "IN_PROGRESS"` sozinho incluiria o Bloqueado.
    const marcam = PADRAO.filter(
      (p) => diasParadoPorColuna(p.coluna, PARADA_HA_MUITO, false) !== null
    );
    expect(marcam.map((p) => p.status).sort()).toEqual(
      ["EXTERNAL_APPROVAL", "IN_PROGRESS", "IN_REVIEW"].sort()
    );
  });
});
