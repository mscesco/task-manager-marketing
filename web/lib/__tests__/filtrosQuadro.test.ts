/**
 * Filtros do quadro por equipe (2026-07-27).
 *
 * O que estes testes travam, em ordem de importancia:
 *
 *   1. HERANCA POR RAIZ -- filtrar pela pessoa que so aparece numa SUBTAREFA
 *      tem de manter o card da raiz. Sem isso o filtro parece quebrado: a
 *      gestao busca a fulana e o quadro fica vazio, mesmo ela tendo trabalho.
 *   2. Escopo interna x compartilhada bate com a classificacao que o quadro
 *      ja usa para a pill do card -- filtro e pill nao podem divergir.
 */

import { describe, it, expect } from "vitest";
import {
  contaFiltrosAtivos,
  escopoDaTask,
  FILTROS_LIMPOS,
  passaEscopo,
  responsaveisPorRaiz,
  passaResponsavel,
  temFiltroAtivo,
  temFiltroNovo,
  type TaskMin,
} from "../filtrosQuadro";

const SEO = "team-seo";
const RAIZ = "team-raiz";
const ANA = "user-ana";
const BRUNO = "user-bruno";

function t(
  id: string,
  extra: Partial<TaskMin> = {},
): TaskMin {
  return {
    id,
    parent_task_id: null,
    team_id: RAIZ,
    assignee_ids: [],
    ...extra,
  };
}

describe("escopoDaTask", () => {
  it("nasceu no subtime -> interna", () => {
    expect(escopoDaTask({ team_id: SEO }, SEO)).toBe("interna");
  });

  it("veio da raiz -> compartilhada", () => {
    expect(escopoDaTask({ team_id: RAIZ }, SEO)).toBe("compartilhada");
  });

  it("fora do modo subtime -> sem escopo", () => {
    expect(escopoDaTask({ team_id: RAIZ }, null)).toBeUndefined();
    expect(escopoDaTask({ team_id: RAIZ }, undefined)).toBeUndefined();
  });
});

describe("passaEscopo", () => {
  it("todos deixa passar qualquer coisa", () => {
    expect(passaEscopo("todos", "interna")).toBe(true);
    expect(passaEscopo("todos", "compartilhada")).toBe(true);
    expect(passaEscopo("todos", undefined)).toBe(true);
  });

  it("filtra pelo escopo escolhido", () => {
    expect(passaEscopo("interna", "interna")).toBe(true);
    expect(passaEscopo("interna", "compartilhada")).toBe(false);
    expect(passaEscopo("compartilhada", "compartilhada")).toBe(true);
    expect(passaEscopo("compartilhada", "interna")).toBe(false);
  });

  it("sem escopo definido, filtro especifico NAO esconde tudo", () => {
    // Quadro geral / de projeto nao tem a distincao. Se o filtro escondesse,
    // uma troca de aba deixaria a tela vazia sem explicacao.
    expect(passaEscopo("interna", undefined)).toBe(true);
  });
});

describe("responsaveisPorRaiz", () => {
  it("agrega o responsavel da propria raiz", () => {
    const tasks = [t("r1", { assignee_ids: [ANA] })];
    expect(responsaveisPorRaiz(tasks).get("r1")).toEqual(new Set([ANA]));
  });

  it("HERANCA: responsavel de subtarefa sobe para a raiz", () => {
    const tasks = [
      t("r1"),
      t("s1", { parent_task_id: "r1", assignee_ids: [ANA] }),
    ];
    expect(responsaveisPorRaiz(tasks).get("r1")).toEqual(new Set([ANA]));
  });

  it("HERANCA em dois niveis (neta)", () => {
    const tasks = [
      t("r1"),
      t("s1", { parent_task_id: "r1" }),
      t("n1", { parent_task_id: "s1", assignee_ids: [BRUNO] }),
    ];
    expect(responsaveisPorRaiz(tasks).get("r1")).toEqual(new Set([BRUNO]));
  });

  it("junta responsaveis de ramos diferentes na mesma raiz", () => {
    const tasks = [
      t("r1", { assignee_ids: [ANA] }),
      t("s1", { parent_task_id: "r1", assignee_ids: [BRUNO] }),
    ];
    expect(responsaveisPorRaiz(tasks).get("r1")).toEqual(
      new Set([ANA, BRUNO]),
    );
  });

  it("raiz sem ninguem na subarvore nao entra no mapa", () => {
    const tasks = [t("r1"), t("s1", { parent_task_id: "r1" })];
    expect(responsaveisPorRaiz(tasks).has("r1")).toBe(false);
  });

  it("pai fora do conjunto carregado: para no topo visivel", () => {
    // Subtarefa cuja mae nao veio na pagina -> ela mesma vira a raiz.
    const tasks = [t("s1", { parent_task_id: "ausente", assignee_ids: [ANA] })];
    expect(responsaveisPorRaiz(tasks).get("s1")).toEqual(new Set([ANA]));
  });

  it("ciclo nao trava (guarda anti-ciclo)", () => {
    const tasks = [
      t("a", { parent_task_id: "b", assignee_ids: [ANA] }),
      t("b", { parent_task_id: "a" }),
    ];
    expect(() => responsaveisPorRaiz(tasks)).not.toThrow();
  });

  it("nao muta a lista recebida", () => {
    const tasks = [t("r1", { assignee_ids: [ANA] })];
    const copia = JSON.parse(JSON.stringify(tasks));
    responsaveisPorRaiz(tasks);
    expect(tasks).toEqual(copia);
  });
});

describe("passaResponsavel", () => {
  const porRaiz = responsaveisPorRaiz([
    t("r1"),
    t("s1", { parent_task_id: "r1", assignee_ids: [ANA] }),
    t("r2", { assignee_ids: [BRUNO] }),
    t("r3"), // ninguem
  ]);

  it("filtro vazio deixa tudo passar", () => {
    expect(passaResponsavel("", "r3", porRaiz)).toBe(true);
  });

  it("O CASO DA GESTAO: pessoa designada so na subtarefa mantem a raiz", () => {
    expect(passaResponsavel(ANA, "r1", porRaiz)).toBe(true);
  });

  it("pessoa sem relacao com a raiz nao passa", () => {
    expect(passaResponsavel(BRUNO, "r1", porRaiz)).toBe(false);
  });

  it("raiz sem responsavel nenhum some quando ha filtro", () => {
    expect(passaResponsavel(ANA, "r3", porRaiz)).toBe(false);
  });

  it("raiz desconhecida no mapa nao quebra", () => {
    expect(passaResponsavel(ANA, "inexistente", porRaiz)).toBe(false);
  });
});

describe("temFiltroNovo", () => {
  it("detecta cada eixo e a combinacao", () => {
    expect(temFiltroNovo("todos", "")).toBe(false);
    expect(temFiltroNovo("interna", "")).toBe(true);
    expect(temFiltroNovo("todos", ANA)).toBe(true);
    expect(temFiltroNovo("compartilhada", ANA)).toBe(true);
  });
});

// -------------------------------------------------------------------
// Painel de filtros (29/07)
// -------------------------------------------------------------------
describe("contaFiltrosAtivos", () => {
  it("zero quando nada estreita o quadro", () => {
    expect(contaFiltrosAtivos(FILTROS_LIMPOS)).toBe(0);
    expect(temFiltroAtivo(FILTROS_LIMPOS)).toBe(false);
  });

  it("conta cada eixo ligado", () => {
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, prazo: "atrasadas" })).toBe(1);
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, subtime: "t1" })).toBe(1);
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, escopo: "interna" })).toBe(1);
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, pessoa: "u1" })).toBe(1);
  });

  it("soma quando ha varios", () => {
    expect(
      contaFiltrosAtivos({
        prazo: "em-dia",
        subtime: "t1",
        escopo: "compartilhada",
        pessoa: "u1",
      })
    ).toBe(4);
  });

  it("string vazia NAO conta -- e o estado 'todos' dos seletores", () => {
    // Se contasse, o badge apareceria com o quadro inteiro visivel e a pessoa
    // ficaria procurando um filtro que nao existe.
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, subtime: "", pessoa: "" })).toBe(0);
  });
});
