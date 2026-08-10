/**
 * PARIDADE — as regras por COLUNA respondem igual às regras por STATUS.
 *
 * ⚠️ ESTE ARQUIVO EXISTE PARA MORRER. Ele autoriza uma coisa que normalmente
 * seria defeito: DUAS implementações da mesma regra convivendo no repositório
 * (`lib/status.ts`, por status; `lib/coluna.ts`, por coluna). A convivência é
 * necessária porque trocar as assinaturas de uma vez deixaria o `tsc` vermelho
 * entre a fatia 4a e a 4c — entrega parcial que quebra o build.
 *
 * **Quando a fatia 4c migrar o último call-site e apagar as funções por status,
 * ESTE ARQUIVO É APAGADO JUNTO.** Se você está lendo isto depois da 4c, a
 * migração ficou pela metade.
 *
 * O QUE ELE PROVA: que traduzir a taxonomia de status para
 * `semantic`/`notify_deadline` NÃO MUDOU O COMPORTAMENTO — nas 8 colunas
 * padrão, que é o único mundo que existe em produção hoje (10/08/2026: um
 * quadro, 802 tarefas).
 *
 * O QUE ELE **NÃO** PROVA: nada sobre coluna criada por gente. Aquele é
 * justamente o mundo em que as regras por status estão erradas — não há com o
 * que comparar. Os casos de coluna nova estão em `coluna.test.ts`.
 *
 * ⚠️ RELÓGIO FAKE OBRIGATÓRIO (Spec 027, D7): `deadlineDays` e `diasParado`
 * chamam `new Date()`. Sem fixar o relógio, este arquivo passaria hoje e
 * quebraria amanhã. Meio-dia LOCAL de propósito (construtor com componentes,
 * não string ISO): string ISO com Z seria interpretada em UTC e a virada de
 * dia dependeria do fuso da máquina. Mesmo padrão do `status.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deadlineTone, diasParado, statusPadraoMinhasTarefas } from "@/lib/status";
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
 * As 8 colunas que todo quadro recebe ao nascer, copiadas de
 * `backend/app/modules/tasks/domain/board_defaults.py` (lido em 10/08/2026).
 *
 * ⚠️ ESTA TABELA É O TESTE. Se ela divergir do backend, este arquivo passa a
 * provar paridade com um mundo que não existe. Ao mexer em `COLUNAS_PADRAO`
 * lá, mexa aqui — não há portão que ligue os dois.
 *
 * ⚠️ REPARE NO BLOCKED: semântica `IN_PROGRESS` com `notify_deadline: false`.
 * É a única coluna cuja semântica sozinha daria a resposta errada, e é a razão
 * de `pararEhNoticia` cruzar os dois campos (ADR 0040, item 3).
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
  };
}

// ---------------------------------------------------------------------------

describe("deadlineTone — paridade caso a caso", () => {
  // ⚠️ Três prazos, não um. Um prazo só provaria a paridade em UM ramo da
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

describe("diasParado — paridade caso a caso", () => {
  for (const { status, coluna } of PADRAO) {
    it(`${status}: parada há muito responde igual`, () => {
      expect(diasParadoPorColuna(coluna, PARADA_HA_MUITO, false)).toBe(
        diasParado(PARADA_HA_MUITO, status, false)
      );
    });

    it(`${status}: mexida agora responde igual`, () => {
      const agora = new Date().toISOString();
      expect(diasParadoPorColuna(coluna, agora, false)).toBe(
        diasParado(agora, status, false)
      );
    });

    it(`${status}: arquivada responde igual`, () => {
      expect(diasParadoPorColuna(coluna, PARADA_HA_MUITO, true)).toBe(
        diasParado(PARADA_HA_MUITO, status, true)
      );
    });
  }
});

// ---------------------------------------------------------------------------

describe("o filtro padrão de /minhas-tarefas", () => {
  it("esconde as mesmas colunas que o padrão por status escondia", () => {
    // ⚠️ Compara CONJUNTOS traduzidos, não listas: a versão por status devolve
    // chaves de status e a por coluna devolve `id` de coluna. O que tem de
    // bater é QUAIS colunas ficam ligadas, não em que formato.
    const porStatus = new Set(statusPadraoMinhasTarefas());
    const esperado = PADRAO.filter((p) => porStatus.has(p.status)).map(
      (p) => p.coluna.id
    );
    const obtido = colunasPadraoMinhasTarefas(PADRAO.map((p) => p.coluna));

    expect(obtido.sort()).toEqual(esperado.sort());
  });

  it("⚠️ Cancelado CONTINUA aparecendo (ADR 0040, item 5)", () => {
    // Não é descuido: `CANCELLED` também é semântica terminal, e esconder as
    // duas seria o comportamento "coerente". Mas hoje a coluna Cancelado
    // aparece, e mudar isso é decisão de produto disfarçada de refatoração.
    // Este teste é o que faz alguém parar e abrir uma ADR antes de mudar.
    const ligadas = colunasPadraoMinhasTarefas(PADRAO.map((p) => p.coluna));
    expect(ligadas).toContain("col-cancel");
    expect(ligadas).not.toContain("col-done");
  });
});

// ---------------------------------------------------------------------------

describe("controle — a paridade não passa por vacuidade", () => {
  // ⚠️ SEM ESTE BLOCO, TUDO ACIMA PODERIA SER VERDE POR AUSÊNCIA DE SINAL.
  // Se as duas implementações devolvessem `null` para todos os 8 casos, os
  // testes de paridade passariam sem provar nada. Estes três afirmam que há
  // sinal de verdade em cada função.
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
    // ⚠️ ESTE É O CASO QUE A TRADUÇÃO INGÊNUA ERRARIA. `semantic ===
    // "IN_PROGRESS"` sozinho incluiria BLOCKED, que a D6 excluiu de propósito.
    const marcam = PADRAO.filter(
      (p) => diasParadoPorColuna(p.coluna, PARADA_HA_MUITO, false) !== null
    );
    expect(marcam.map((p) => p.status).sort()).toEqual(
      ["EXTERNAL_APPROVAL", "IN_PROGRESS", "IN_REVIEW"].sort()
    );
  });
});
