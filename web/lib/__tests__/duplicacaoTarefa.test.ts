import { describe, expect, it } from "vitest";

import {
  LIMITE_TITULO,
  PREFIXO_COPIA,
  rotuloCaixaSubtarefas,
  tituloDaCopia,
  valoresIniciaisDaCopia,
} from "@/lib/duplicacaoTarefa";

const ANA = "user-ana";
const SUMIDO = "user-sumido";

const ORIGEM = {
  title: "Campanha Black Friday",
  description: "briefing completo",
  priority: "HIGH",
  assignee_ids: [ANA, SUMIDO],
};

/** Todo mundo da origem pode -- o caso comum. */
const TODOS = new Set([ANA, SUMIDO]);

function filha(is_archived = false) {
  return { is_archived };
}

describe("tituloDaCopia", () => {
  it("prefixa", () => {
    expect(tituloDaCopia("Campanha")).toBe("Cópia de Campanha");
  });

  it("o prefixo sobrevive inteiro ao truncamento", () => {
    // Truncar o RESULTADO comeria o próprio prefixo: "Cópia d".
    const r = tituloDaCopia("y".repeat(500));
    expect(r.startsWith(PREFIXO_COPIA)).toBe(true);
    expect(r.length).toBe(LIMITE_TITULO);
  });

  it("título vazio não quebra", () => {
    expect(tituloDaCopia("")).toBe(PREFIXO_COPIA);
  });
});

describe("valoresIniciaisDaCopia", () => {
  it("descrição e prioridade vêm da origem", () => {
    const v = valoresIniciaisDaCopia(ORIGEM, TODOS, []);
    expect(v.description).toBe("briefing completo");
    expect(v.priority).toBe("HIGH");
  });

  it("datas sempre vazias, mesmo com a origem cheia", () => {
    // Cópia com data velha nasce vencida e o job dispara TASK_OVERDUE em lote.
    const v = valoresIniciaisDaCopia(
      { ...ORIGEM, ...{ start_date: "2026-03-01", due_date: "2026-03-10" } },
      TODOS,
      [],
    );
    expect(v.startDate).toBe("");
    expect(v.dueDate).toBe("");
  });

  it("responsável fora do alcance (inclusive desativado) não entra no pré-preenchimento", () => {
    const v = valoresIniciaisDaCopia(ORIGEM, new Set([ANA]), []);
    expect(v.assigneeIds).toEqual([ANA]);
  });

  it("ninguém permitido -> lista vazia, e o modal cobra escolha", () => {
    const v = valoresIniciaisDaCopia(ORIGEM, new Set(), []);
    expect(v.assigneeIds).toEqual([]);
  });

  it("origem sem responsável não quebra", () => {
    const v = valoresIniciaisDaCopia(
      { title: "t", description: "", priority: "MEDIUM" },
      TODOS,
      [],
    );
    expect(v.assigneeIds).toEqual([]);
  });

  it("arquivada não conta em subtarefasVivas", () => {
    // Ver 6 e receber 4 faz a pessoa achar que perdeu duas.
    const v = valoresIniciaisDaCopia(ORIGEM, TODOS, [
      filha(),
      filha(true),
      filha(),
      filha(true),
    ]);
    expect(v.subtarefasVivas).toBe(2);
  });

  it("sem filhas -> zero", () => {
    expect(valoresIniciaisDaCopia(ORIGEM, TODOS, []).subtarefasVivas).toBe(0);
  });
});

describe("rotuloCaixaSubtarefas", () => {
  it("some quando não há filha viva", () => {
    expect(rotuloCaixaSubtarefas(0)).toBeNull();
  });

  it('a palavra "diretas" é obrigatória', () => {
    // Havendo neto, chegam MAIS tarefas do que o número mostrado. Sem
    // "diretas", a pessoa vê 4, recebe 7, e acha que o sistema inventou.
    const r = rotuloCaixaSubtarefas(4);
    expect(r).toContain("4");
    expect(r).toContain("diretas");
  });
});
