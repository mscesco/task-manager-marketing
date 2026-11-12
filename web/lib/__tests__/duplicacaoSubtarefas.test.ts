/**
 * Passo 2 da duplicação:
 *   1. nenhuma subtarefa sai daqui sem responsável;
 *   2. o passo 2 não aparece no caso comum (senão vira pedágio num clique);
 *   3. o payload nunca leva lista vazia: o backend recusa.
 */

import { describe, it, expect } from "vitest";
import {
  linhasDasSubtarefas,
  haPendencias,
  motivoNaoDuplicar,
  payloadDasSubtarefas,
  textoDaPendencia,
} from "../duplicacaoSubtarefas";

const ANA = "u-ana";
const BIA = "u-bia";
const INATIVO = "u-inativo";

const PODEM = new Set([ANA, BIA]);

const filha = (
  id: string,
  title: string,
  assignee_ids: string[] = [],
  is_archived = false
) => ({ id, title, assignee_ids, is_archived });

describe("linhasDasSubtarefas", () => {
  it("herda quem pode e descarta quem não pode", () => {
    const [l] = linhasDasSubtarefas(
      [filha("s1", "Roteiro", [ANA, INATIVO])],
      PODEM
    );
    expect(l.herdados).toEqual([ANA]);
    expect(l.descartados).toEqual([INATIVO]);
    expect(l.pendente).toBeNull();
  });

  it("todos inválidos -> pendente por INVÁLIDOS, não por ausência", () => {
    // ⚠️ A distinção manda na frase da tela: "quem respondia não pode
    // assumir" é o que a pessoa não tem como adivinhar sozinha.
    const [l] = linhasDasSubtarefas(
      [filha("s1", "Roteiro", [INATIVO])],
      PODEM
    );
    expect(l.pendente).toBe("responsaveis-invalidos");
    expect(textoDaPendencia(l)).toContain("não pode assumir");
  });

  it("sem responsável nenhum -> pendente por AUSÊNCIA", () => {
    const [l] = linhasDasSubtarefas([filha("s1", "Roteiro", [])], PODEM);
    expect(l.pendente).toBe("sem-responsavel");
    expect(textoDaPendencia(l)).toContain("Ninguém responde");
  });

  it("ARQUIVADA não entra: ela nem é copiada", () => {
    const linhas = linhasDasSubtarefas(
      [filha("s1", "Viva", [ANA]), filha("s2", "Velha", [], true)],
      PODEM
    );
    expect(linhas.map((l) => l.id)).toEqual(["s1"]);
  });

  it("lista de PERMITIDOS vazia deixa tudo pendente, sem quebrar", () => {
    // Cenário real: `listMembers` falhou. Regra positiva falha FECHADA, e é
    // isso que se quer -- pendente é conserta na tela; passar batido é 422.
    const linhas = linhasDasSubtarefas(
      [filha("s1", "Roteiro", [ANA])],
      new Set()
    );
    expect(linhas[0].pendente).toBe("responsaveis-invalidos");
  });
});

describe("haPendencias -- o passo 2 só aparece quando há assunto", () => {
  it("todas resolvidas -> NÃO aparece", () => {
    const linhas = linhasDasSubtarefas(
      [filha("s1", "A", [ANA]), filha("s2", "B", [BIA])],
      PODEM
    );
    expect(haPendencias(linhas)).toBe(false);
  });

  it("uma pendente -> aparece", () => {
    const linhas = linhasDasSubtarefas(
      [filha("s1", "A", [ANA]), filha("s2", "B", [INATIVO])],
      PODEM
    );
    expect(haPendencias(linhas)).toBe(true);
  });

  it("CONTINUA aparecendo depois de resolvida -- a linha não some do olho", () => {
    // Esconder o bloco quando não falta nada faria a linha sumir no instante
    // em que a pessoa escolhe o responsável.
    const linhas = linhasDasSubtarefas([filha("s1", "A", [INATIVO])], PODEM);
    expect(haPendencias(linhas)).toBe(true);
    expect(motivoNaoDuplicar(linhas, { s1: [BIA] }, new Set())).toBeNull();
  });

  it("continua aparecendo depois de pulada, pelo mesmo motivo", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [INATIVO])], PODEM);
    expect(haPendencias(linhas)).toBe(true);
    expect(motivoNaoDuplicar(linhas, {}, new Set(["s1"]))).toBeNull();
  });
});

describe("motivoNaoDuplicar -- o botão trava e DIZ por quê", () => {
  const VAZIO = new Set<string>();

  it("nada pendente -> null", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    expect(motivoNaoDuplicar(linhas, {}, VAZIO)).toBeNull();
  });

  it("uma pendente -> nomeia a subtarefa", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "Roteiro", [])], PODEM);
    expect(motivoNaoDuplicar(linhas, {}, VAZIO)).toContain("Roteiro");
  });

  it("várias -> conta, em vez de listar", () => {
    const linhas = linhasDasSubtarefas(
      [filha("s1", "A", []), filha("s2", "B", [])],
      PODEM
    );
    expect(motivoNaoDuplicar(linhas, {}, VAZIO)).toContain("2 subtarefas");
  });
});

describe("payloadDasSubtarefas", () => {
  const VAZIO = new Set<string>();

  it("linha resolvida SEM escolha não entra -- ausência = herda como sempre", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    expect(payloadDasSubtarefas(linhas, {}, VAZIO)).toEqual({
      subtask_assignees: {},
      skip_subtasks: [],
    });
  });

  it("escolha explícita entra, inclusive sobre linha já resolvida", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    const p = payloadDasSubtarefas(linhas, { s1: [BIA] }, VAZIO);
    expect(p.subtask_assignees).toEqual({ s1: [BIA] });
  });

  it("NUNCA emite lista vazia -- o backend recusa, e recusa certo", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    const p = payloadDasSubtarefas(linhas, { s1: [] }, VAZIO);
    expect(p.subtask_assignees).toEqual({});
  });

  it("PULADA ganha de escolha -- vale o último gesto", () => {
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    const p = payloadDasSubtarefas(linhas, { s1: [BIA] }, new Set(["s1"]));
    expect(p.subtask_assignees).toEqual({});
    expect(p.skip_subtasks).toEqual(["s1"]);
  });

  it("id fora das linhas não vai em skip -- o backend recusaria o lote", () => {
    // Acontece com id de subtarefa ARQUIVADA, que não está nas linhas.
    const linhas = linhasDasSubtarefas([filha("s1", "A", [ANA])], PODEM);
    const p = payloadDasSubtarefas(linhas, {}, new Set(["s1", "fantasma"]));
    expect(p.skip_subtasks).toEqual(["s1"]);
  });
});
