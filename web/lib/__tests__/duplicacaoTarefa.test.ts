import { describe, expect, it } from "vitest";

import {
  avisoSemResponsaveis,
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

function filha(is_archived = false) {
  return { is_archived };
}

describe("tituloDaCopia (D8)", () => {
  it("prefixa", () => {
    expect(tituloDaCopia("Campanha")).toBe("Cópia de Campanha");
  });

  it("título no limite NÃO estoura o campo", () => {
    // Sem truncar, isto viraria 255 + 9 e o salvar devolveria 422 numa
    // operação que a pessoa acha que é um clique.
    const longo = "x".repeat(LIMITE_TITULO);
    const r = tituloDaCopia(longo);
    expect(r.length).toBe(LIMITE_TITULO);
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
    const v = valoresIniciaisDaCopia(ORIGEM, new Set(), []);
    expect(v.description).toBe("briefing completo");
    expect(v.priority).toBe("HIGH");
  });

  /**
   * O TESTE QUE CARREGA A D5. Datas vazias não são esquecimento: cópia com
   * data velha nasce vencida e o job dispara TASK_OVERDUE em lote na primeira
   * execução (51 numa única execução em 01/08).
   */
  it("D5 -- datas SEMPRE vazias, mesmo com a origem cheia", () => {
    const v = valoresIniciaisDaCopia(
      { ...ORIGEM, ...{ start_date: "2026-03-01", due_date: "2026-03-10" } },
      new Set(),
      [],
    );
    expect(v.startDate).toBe("");
    expect(v.dueDate).toBe("");
  });

  it("D9 -- responsável fora do alcance não entra no pré-preenchimento", () => {
    const v = valoresIniciaisDaCopia(ORIGEM, new Set([SUMIDO]), []);
    expect(v.assigneeIds).toEqual([ANA]);
  });

  it("todos excluídos -> lista vazia, e o modal cobra escolha", () => {
    const v = valoresIniciaisDaCopia(ORIGEM, new Set([ANA, SUMIDO]), []);
    expect(v.assigneeIds).toEqual([]);
  });

  it("origem sem responsável não quebra", () => {
    const v = valoresIniciaisDaCopia(
      { title: "t", description: "", priority: "MEDIUM" },
      new Set(),
      [],
    );
    expect(v.assigneeIds).toEqual([]);
  });

  it("D10 -- arquivada NÃO conta em subtarefasVivas", () => {
    // Ver 6 e receber 4 faz a pessoa achar que perdeu duas.
    const v = valoresIniciaisDaCopia(ORIGEM, new Set(), [
      filha(),
      filha(true),
      filha(),
      filha(true),
    ]);
    expect(v.subtarefasVivas).toBe(2);
  });

  it("sem filhas -> zero", () => {
    expect(valoresIniciaisDaCopia(ORIGEM, new Set(), []).subtarefasVivas).toBe(
      0,
    );
  });
});

describe("rotuloCaixaSubtarefas (D7)", () => {
  it("some quando não há filha viva (critério 16)", () => {
    expect(rotuloCaixaSubtarefas(0)).toBeNull();
  });

  it('a palavra "diretas" é obrigatória (D4)', () => {
    // Havendo neto, chegam MAIS tarefas do que o número mostrado. Sem
    // "diretas", a pessoa vê 4, recebe 7, e acha que o sistema inventou.
    const r = rotuloCaixaSubtarefas(4);
    expect(r).toContain("4");
    expect(r).toContain("diretas");
  });
});

describe("avisoSemResponsaveis (D14)", () => {
  it("cala quando os responsáveis vão junto", () => {
    expect(avisoSemResponsaveis(true, true, 3)).toBeNull();
  });

  it("cala quando as subtarefas não vão", () => {
    expect(avisoSemResponsaveis(false, false, 3)).toBeNull();
  });

  it("cala quando não há subtarefa viva", () => {
    expect(avisoSemResponsaveis(true, false, 0)).toBeNull();
  });

  /**
   * ⚠️ Este aviso é a ÚNICA proteção que sobrou. A regra de 29/07 nasceu
   * porque 44 das 50 tarefas ativas sem responsável eram subtarefas; a caixa
   * desmarcada recria isso de N em N num clique. A porta foi aberta de
   * propósito (D14, opção 2) -- com aviso.
   */
  it("AVISA quando as subtarefas vão sem responsável", () => {
    expect(avisoSemResponsaveis(true, false, 3)).toContain("3");
    expect(avisoSemResponsaveis(true, false, 3)).toContain("sem responsável");
  });

  it("singular no caso de uma", () => {
    const r = avisoSemResponsaveis(true, false, 1);
    expect(r).toContain("A subtarefa");
    expect(r).not.toContain("As 1");
  });
});
