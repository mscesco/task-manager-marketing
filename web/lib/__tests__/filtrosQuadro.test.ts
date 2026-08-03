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
  pillDoEscopo,
  listaFiltrosAtivos,
  normalizarBusca,
  passaEscopo,
  responsaveisPorRaiz,
  passaResponsavel,
  temFiltroAtivo,
  temFiltroNovo,
  type TaskMin,
} from "../filtrosQuadro";

const SEO = "team-seo";
const RAIZ = "team-raiz";
const PROJ_SEO = "proj-do-seo";
const PROJ_RAIZ = "proj-da-raiz";
const PROJ_PESSOAL = "proj-pessoal";
const PROJ_FORA_DO_MAPA = "proj-truncado";

/** project_id -> team_id do projeto, como o Board monta de listAllProjects. */
const PROJETOS = new Map<string, string | null>([
  [PROJ_SEO, SEO],
  [PROJ_RAIZ, RAIZ],
  [PROJ_PESSOAL, null],
]);

/** Tarefa avulsa (sem projeto), no minimo que escopoDaTask precisa. */
function avulsa(team_id: string | null) {
  return { team_id, project_id: null };
}

/** Tarefa dentro de um projeto. */
function noProjeto(team_id: string | null, project_id: string) {
  return { team_id, project_id };
}
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
  // ---- avulsa: o time da TAREFA e a lente (comportamento de sempre) ----
  it("avulsa que nasceu no subtime -> interna", () => {
    expect(escopoDaTask(avulsa(SEO), SEO, PROJETOS)).toBe("interna");
  });

  it("avulsa que veio da raiz -> compartilhada", () => {
    expect(escopoDaTask(avulsa(RAIZ), SEO, PROJETOS)).toBe("compartilhada");
  });

  it("avulsa sem time -> compartilhada", () => {
    expect(escopoDaTask(avulsa(null), SEO, PROJETOS)).toBe("compartilhada");
  });

  it("fora do modo subtime -> sem escopo", () => {
    expect(escopoDaTask(avulsa(RAIZ), null, PROJETOS)).toBeUndefined();
    expect(escopoDaTask(avulsa(RAIZ), undefined, PROJETOS)).toBeUndefined();
  });

  // ---- em projeto: o time do PROJETO manda (§8) ----
  it("em projeto do subtime -> interna", () => {
    expect(escopoDaTask(noProjeto(SEO, PROJ_SEO), SEO, PROJETOS)).toBe(
      "interna",
    );
  });

  /**
   * ESTE e o teste que carrega o §8. As 7 tarefas encontradas em producao
   * tinham exatamente esta forma: team_id do subtime, dentro de um projeto da
   * raiz. Ate 03/08 vinham marcadas "Interna" -- e o workspace inteiro as via,
   * porque quem ve o projeto ve a tarefa (task_guards.py:67-69).
   */
  it("time do subtime MAS projeto da raiz -> compartilhada, nao interna", () => {
    expect(escopoDaTask(noProjeto(SEO, PROJ_RAIZ), SEO, PROJETOS)).toBe(
      "compartilhada",
    );
  });

  it("o team_id da tarefa nao muda nada quando ha projeto", () => {
    // Mesmo projeto, tres times diferentes na tarefa: o rotulo nao se mexe.
    for (const time of [SEO, RAIZ, null]) {
      expect(escopoDaTask(noProjeto(time, PROJ_SEO), SEO, PROJETOS)).toBe(
        "interna",
      );
    }
  });

  // ---- D3/D4: quando nao da pra prometer nada ----
  it("D3 -- projeto AUSENTE do mapa -> indefinido, nunca interna", () => {
    // Lista truncada em 1000, projeto arquivado, ou listAllProjects falhou.
    expect(
      escopoDaTask(noProjeto(SEO, PROJ_FORA_DO_MAPA), SEO, PROJETOS),
    ).toBe("indefinido");
  });

  it("D3 -- mapa VAZIO nao faz nada virar interna", () => {
    // O caso da chamada que falhou: nenhuma tarefa em projeto pode ser
    // classificada, e nenhuma pode ser prometida como confidencial.
    expect(escopoDaTask(noProjeto(SEO, PROJ_SEO), SEO, new Map())).toBe(
      "indefinido",
    );
  });

  it("D4 -- projeto SEM time -> indefinido", () => {
    expect(escopoDaTask(noProjeto(SEO, PROJ_PESSOAL), SEO, PROJETOS)).toBe(
      "indefinido",
    );
  });
});

describe("pillDoEscopo", () => {
  it("indefinido NAO desenha pill", () => {
    expect(pillDoEscopo("indefinido")).toBeUndefined();
  });

  it("escopo real passa direto", () => {
    expect(pillDoEscopo("interna")).toBe("interna");
    expect(pillDoEscopo("compartilhada")).toBe("compartilhada");
    expect(pillDoEscopo(undefined)).toBeUndefined();
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

  it("indefinido e o OPOSTO de undefined: filtro especifico esconde", () => {
    // Dentro do modo subtime, "nao sei classificar" nao pode aparecer em
    // "So internas" -- seria repetir a promessa quebrada do §8.
    expect(passaEscopo("interna", "indefinido")).toBe(false);
    expect(passaEscopo("compartilhada", "indefinido")).toBe(false);
    // Mas "Todas" continua mostrando: esconder da visao sem filtro seria
    // sumir com a tarefa do quadro de quem a criou.
    expect(passaEscopo("todos", "indefinido")).toBe(true);
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
        ...FILTROS_LIMPOS,
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

// -------------------------------------------------------------------
// Pastilhas de filtro ativo (Spec 031, C3)
// -------------------------------------------------------------------
describe("listaFiltrosAtivos", () => {
  const rotulos = (
    f: Parameters<typeof listaFiltrosAtivos>[0],
    n?: Parameters<typeof listaFiltrosAtivos>[1]
  ) => listaFiltrosAtivos(f, n).map((c) => c.rotulo);

  it("nada ligado -> lista vazia", () => {
    expect(listaFiltrosAtivos(FILTROS_LIMPOS)).toEqual([]);
  });

  it("BUSCA vira pastilha -- era o furo numero um do badge", () => {
    // Antes da C3 o badge dizia "0" com a busca preenchida.
    expect(rotulos({ ...FILTROS_LIMPOS, busca: "landing" })).toEqual([
      "Busca: landing",
    ]);
    expect(contaFiltrosAtivos({ ...FILTROS_LIMPOS, busca: "landing" })).toBe(1);
  });

  it("busca so de espaco NAO vira pastilha", () => {
    expect(listaFiltrosAtivos({ ...FILTROS_LIMPOS, busca: "   " })).toEqual([]);
  });

  it("busca longa e truncada -- a pastilha divide a linha com outras", () => {
    const longa = "a".repeat(60);
    const [chip] = listaFiltrosAtivos({ ...FILTROS_LIMPOS, busca: longa });
    expect(chip.rotulo.length).toBeLessThan(40);
    expect(chip.rotulo.endsWith("\u2026")).toBe(true);
  });

  it("ARQUIVADAS vira pastilha -- era o furo numero dois", () => {
    expect(rotulos({ ...FILTROS_LIMPOS, arquivadas: true })).toEqual([
      "Incluindo arquivadas",
    ]);
  });

  it("arquivadas NAO entra na contagem -- ela alarga, nao estreita", () => {
    // A contagem responde "quanta coisa esta escondida de mim". Ver MAIS
    // coisa nao pode fazer esse numero subir.
    const f = { ...FILTROS_LIMPOS, arquivadas: true };
    expect(listaFiltrosAtivos(f)).toHaveLength(1);
    expect(contaFiltrosAtivos(f)).toBe(0);
  });

  it("resolve id -> nome; sem o nome, nao vaza uuid na tela", () => {
    const f = { ...FILTROS_LIMPOS, subtime: "t1", pessoa: "u9" };
    expect(rotulos(f, { subtimes: new Map([["t1", "M\u00eddia Paga"]]) })).toEqual([
      "Equipe: M\u00eddia Paga",
      "Respons\u00e1vel: outra pessoa",
    ]);
    for (const chip of listaFiltrosAtivos(f)) {
      expect(chip.rotulo).not.toContain("t1");
      expect(chip.rotulo).not.toContain("u9");
    }
  });

  it("campo aponta o que o botao de remover limpa", () => {
    const f = { ...FILTROS_LIMPOS, busca: "x", prazo: "atrasadas" as const };
    expect(listaFiltrosAtivos(f).map((c) => c.campo)).toEqual(["busca", "prazo"]);
  });

  it("contagem e lista NAO podem divergir nos eixos que estreitam", () => {
    const f = {
      ...FILTROS_LIMPOS,
      busca: "x",
      prazo: "em-dia" as const,
      subtime: "t1",
      escopo: "interna" as const,
      pessoa: "u1",
    };
    expect(listaFiltrosAtivos(f)).toHaveLength(5);
    expect(contaFiltrosAtivos(f)).toBe(5);
    expect(contaFiltrosAtivos({ ...f, arquivadas: true })).toBe(5);
  });
});

describe("normalizarBusca", () => {
  it("casa sem acento e sem caixa -- 'midia' acha 'Midia Paga'", () => {
    expect(normalizarBusca("  MÍDIA Paga ")).toBe("midia paga");
    expect(normalizarBusca("Ação")).toBe("acao");
  });
  it("e a MESMA regra nas duas telas -- funcao unica, sem copia local", () => {
    expect(normalizarBusca("Órçãmento")).toBe(normalizarBusca("orcamento"));
  });
});
