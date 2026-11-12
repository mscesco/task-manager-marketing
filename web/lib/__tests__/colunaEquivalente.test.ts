/**
 * `coluna de outro quadro -> coluna desta tela`: a mesma regra de dois degraus
 * do backend (`BoardRepository.coluna_para_status`), exata primeiro, alvo da
 * semântica depois.
 *
 * A fixture separa posição de alvo: "a primeira que achar" e "o alvo da
 * semântica" têm de dar respostas diferentes, senão o teste não discrimina.
 */

import { describe, expect, it } from "vitest";
import {
  colunaEquivalente,
  indiceDeColunas,
  rotuloDeColuna,
  type Coluna,
} from "@/lib/coluna";

function col(
  id: string,
  name: string,
  semantic: Coluna["semantic"],
  position: number,
  is_default_target: boolean,
): Coluna {
  // Literal tipado em vez de `as Coluna`: o `as` cala o `tsc` sobre campo inexistente.
  return {
    id,
    name,
    color: "var(--x)",
    position,
    semantic,
    notify_deadline: true,
    is_default_target,
    // `colunaEquivalente` não lê este campo; o geral tem as 8 colunas da ponte.
    is_status_bridge: true,
  };
}

/** O Quadro geral: 8 colunas, 4 alvos. */
const GERAL: Coluna[] = [
  col("g1", "Backlog", "OPEN", 0, true),
  col("g2", "Planejado", "OPEN", 1, false),
  col("g3", "Em Andamento", "IN_PROGRESS", 2, true),
  col("g4", "Aprovação Interna", "IN_PROGRESS", 3, false),
  col("g5", "Aprovação Externa", "IN_PROGRESS", 4, false),
  col("g6", "Concluído", "DONE", 5, true),
  col("g7", "Cancelado", "CANCELLED", 6, true),
  col("g8", "Bloqueado", "IN_PROGRESS", 7, false),
];

/** Um quadro avulso de 4 colunas, mais uma criada por gente. */
const AVULSO: Coluna[] = [
  col("a1", "Backlog", "OPEN", 0, true),
  col("a2", "Em Andamento", "IN_PROGRESS", 1, true),
  col("a3", "Em Revisão", "IN_PROGRESS", 2, false),
  col("a4", "Concluído", "DONE", 3, true),
  col("a5", "Cancelado", "CANCELLED", 4, true),
];

describe("colunaEquivalente", () => {
  it("degrau 1: a coluna do proprio quadro e ela mesma", () => {
    for (const c of GERAL) {
      expect(colunaEquivalente(c, GERAL)?.id).toBe(c.id);
    }
  });

  it("o degrau exato vem antes do alvo da semantica", () => {
    // `Aprovação Externa` tem semantica IN_PROGRESS, e `Em Andamento` e o alvo
    // dessa semantica. Invertendo os degraus, esta linha devolveria `g3`.
    expect(colunaEquivalente(GERAL[4], GERAL)?.name).toBe("Aprovação Externa");
  });

  it("degrau 2: coluna de outro quadro cai no alvo da semantica", () => {
    // "Em Revisão" (avulso, IN_PROGRESS, NAO e alvo) -> "Em Andamento" no
    // geral, e nao "Backlog", que e a primeira por posicao.
    expect(colunaEquivalente(AVULSO[2], GERAL)?.name).toBe("Em Andamento");
  });

  it("a resposta nao depende da ordem do array", () => {
    // No `GERAL` ordenado, o alvo de IN_PROGRESS tambem e a primeira por
    // posicao. Aqui `Aprovação Interna` (nao e alvo) vem antes: a regra errada
    // ("a primeira da semantica") devolveria ela.
    const embaralhado = [
      GERAL[3], // Aprovação Interna
      GERAL[4], // Aprovação Externa
      GERAL[7], // Bloqueado
      GERAL[2], // Em Andamento  <- o alvo, por ultimo
      GERAL[1], // Planejado
      GERAL[0], // Backlog       <- o alvo de OPEN, depois do Planejado
      GERAL[5],
      GERAL[6],
    ];
    expect(colunaEquivalente(AVULSO[2], embaralhado)?.name).toBe(
      "Em Andamento",
    );
    // E o mesmo vale para `OPEN`: `Planejado` vem antes de `Backlog`.
    const plannedAvulso = col("z1", "A fazer", "OPEN", 0, false);
    expect(colunaEquivalente(plannedAvulso, embaralhado)?.name).toBe("Backlog");
  });

  it("degrau 2 nas quatro semanticas, do avulso para o geral", () => {
    const esperado: Array<[string, string]> = [
      ["Backlog", "Backlog"],
      ["Em Andamento", "Em Andamento"],
      ["Em Revisão", "Em Andamento"],
      ["Concluído", "Concluído"],
      ["Cancelado", "Cancelado"],
    ];
    for (const [origem, destino] of esperado) {
      const c = AVULSO.find((x) => x.name === origem)!;
      expect(colunaEquivalente(c, GERAL)?.name).toBe(destino);
    }
  });

  it("do GERAL para o avulso, os quatro status extras colapsam", () => {
    // A perda e de proposito: um quadro de quatro colunas nao representa
    // `Aprovação Externa` nem `Bloqueado`.
    expect(colunaEquivalente(GERAL[3], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[4], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[7], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[1], AVULSO)?.name).toBe("Backlog");
  });

  it("degrau 3: sem coluna daquela semantica devolve undefined", () => {
    // `undefined`, e nao "a primeira coluna": quem chama tem de avisar.
    const semCancelado = GERAL.filter((c) => c.semantic !== "CANCELLED");
    expect(colunaEquivalente(AVULSO[4], semCancelado)).toBeUndefined();
  });

  it("semantica com coluna mas sem ALVO tambem devolve undefined", () => {
    // Estado que o CRUD nao deve permitir, e que a funcao nao adivinha.
    const semAlvo = GERAL.map((c) =>
      c.semantic === "IN_PROGRESS" ? { ...c, is_default_target: false } : c,
    );
    expect(colunaEquivalente(AVULSO[2], semAlvo)).toBeUndefined();
  });

  it("destino vazio devolve undefined, e nao explode", () => {
    expect(colunaEquivalente(GERAL[0], [])).toBeUndefined();
  });
});

describe("indiceDeColunas", () => {
  const QUADROS = [
    { id: "b-geral", name: "Quadro geral", colunas: GERAL },
    { id: "b-campanhas", name: "Campanhas", colunas: AVULSO },
  ];

  it("coluna do quadro da tela vem com nomeDoQuadro null", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("g3")).toEqual({ coluna: GERAL[2], nomeDoQuadro: null });
  });

  it("coluna de outro quadro vem com o nome do quadro", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("a3")).toEqual({ coluna: AVULSO[2], nomeDoQuadro: "Campanhas" });
  });

  it("coluna que nao esta em quadro nenhum nao entra no indice", () => {
    // Caso normal de `/arquivadas`: a tarefa pode viver num quadro que nao veio na lista.
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("nao-existe")).toBeUndefined();
  });

  it("cobre TODAS as colunas de TODOS os quadros", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.size).toBe(GERAL.length + AVULSO.length);
  });

  it("sem quadro da tela, nenhuma coluna e 'daqui'", () => {
    // `quadroDaTela = null`: nao ha quadro padrao; o indice continua cheio.
    const i = indiceDeColunas(QUADROS, null);
    expect(i.get("g3")?.nomeDoQuadro).toBe("Quadro geral");
    expect(i.get("a3")?.nomeDoQuadro).toBe("Campanhas");
  });
});

describe("rotuloDeColuna", () => {
  it("quadro da propria tela: so o nome da coluna", () => {
    expect(
      rotuloDeColuna({ coluna: GERAL[2], nomeDoQuadro: null }),
    ).toBe("Em Andamento");
  });

  it("outro quadro: as DUAS informacoes", () => {
    expect(
      rotuloDeColuna({ coluna: AVULSO[2], nomeDoQuadro: "Campanhas" }),
    ).toBe("Campanhas · Em Revisão");
  });

  it("coluna desconhecida devolve null -- a reserva e do chamador", () => {
    expect(rotuloDeColuna(undefined)).toBeNull();
  });
});
