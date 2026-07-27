/**
 * Spec 028 -- regras de gestao de membros no front.
 *
 * Estes testes espelham os de integracao do backend
 * (tests/integration/test_supervisor_member_scope_db.py). Se um lado mudar
 * sem o outro, a tela passa a oferecer botao que o servidor recusa com 403
 * -- ou, pior, esconde acao que a pessoa poderia fazer.
 *
 * A trava que mais importa e a mesma la e aqui: supervisor NAO alcanca
 * outro subtime.
 */

import { describe, it, expect } from "vitest";
import {
  alcanceDe,
  podeGerenciarAlgo,
  podeCadastrarMembro,
  podeResetarSenha,
  podeDesativarConta,
  podeTrocarPapel,
  podeMoverSubtime,
  podeAdicionarAoTime,
  podeRemoverDoTime,
  papeisAtribuiveis,
  timesParaAdicionar,
  temAcaoPossivel,
  type Alcance,
} from "../permissoesMembros";
import type { Team } from "../api";

const SEO = "team-seo";
const CRM = "team-crm";
const RAIZ = "team-raiz";

const AMPLO: Alcance = { tipo: "amplo" };
const SUP: Alcance = { tipo: "subtime", subtimes: [SEO] };
const NADA: Alcance = { tipo: "nenhum" };

function time(id: string, parent: string | null = RAIZ): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: parent,
    name: id,
    slug: id,
  };
}

describe("alcanceDe", () => {
  it("team.manage vira alcance amplo", () => {
    const a = alcanceDe({ permissions: ["team.manage"], teams: [] });
    expect(a.tipo).toBe("amplo");
  });

  it("member.manage.subteam vira alcance de subtime, com os times supervisionados", () => {
    const a = alcanceDe({
      permissions: ["member.manage.subteam"],
      teams: [
        { team_id: SEO, role: "SUPERVISOR" },
        { team_id: RAIZ, role: "OPERATOR" },
      ],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("so entra no alcance o time onde o papel e SUPERVISOR", () => {
    const a = alcanceDe({
      permissions: ["member.manage.subteam"],
      teams: [
        { team_id: SEO, role: "SUPERVISOR" },
        { team_id: CRM, role: "OPERATOR" },
      ],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("sem permissao nenhuma, alcance nenhum", () => {
    expect(alcanceDe({ permissions: ["task.create"], teams: [] }).tipo).toBe(
      "nenhum",
    );
  });

  it("ator ausente (ainda carregando) nao libera nada", () => {
    expect(alcanceDe(null).tipo).toBe("nenhum");
    expect(alcanceDe(undefined).tipo).toBe("nenhum");
  });

  it("quem tem as duas permissoes fica com a maior", () => {
    const a = alcanceDe({
      permissions: ["member.manage.subteam", "team.manage"],
      teams: [{ team_id: SEO, role: "SUPERVISOR" }],
    });
    expect(a.tipo).toBe("amplo");
  });
});

describe("acoes que a 028 NAO abriu ao supervisor", () => {
  it.each([
    ["cadastrar membro (D3)", podeCadastrarMembro],
    ["resetar senha", podeResetarSenha],
    ["desativar conta (D4)", podeDesativarConta],
    ["trocar papel (D2)", podeTrocarPapel],
    ["mover de subtime (D1)", podeMoverSubtime],
  ])("%s: so alcance amplo", (_nome, fn) => {
    expect(fn(AMPLO)).toBe(true);
    expect(fn(SUP)).toBe(false);
    expect(fn(NADA)).toBe(false);
  });
});

describe("podeAdicionarAoTime", () => {
  it("supervisor adiciona OPERATOR no proprio subtime", () => {
    expect(podeAdicionarAoTime(SUP, SEO, "OPERATOR")).toBe(true);
  });

  it("A TRAVA D1: supervisor NAO adiciona em outro subtime", () => {
    expect(podeAdicionarAoTime(SUP, CRM, "OPERATOR")).toBe(false);
  });

  it("supervisor nao adiciona na raiz", () => {
    expect(podeAdicionarAoTime(SUP, RAIZ, "OPERATOR")).toBe(false);
  });

  it("D2: supervisor nao atribui papel acima de OPERATOR", () => {
    expect(podeAdicionarAoTime(SUP, SEO, "SUPERVISOR")).toBe(false);
    expect(podeAdicionarAoTime(SUP, SEO, "MANAGER")).toBe(false);
    expect(podeAdicionarAoTime(SUP, SEO, "ADMIN")).toBe(false);
  });

  it("alcance amplo passa em qualquer time e papel", () => {
    expect(podeAdicionarAoTime(AMPLO, CRM, "SUPERVISOR")).toBe(true);
    expect(podeAdicionarAoTime(AMPLO, RAIZ, "MANAGER")).toBe(true);
  });

  it("sem alcance, nada", () => {
    expect(podeAdicionarAoTime(NADA, SEO, "OPERATOR")).toBe(false);
  });
});

describe("podeRemoverDoTime", () => {
  it("supervisor remove OPERATOR do proprio subtime", () => {
    expect(podeRemoverDoTime(SUP, SEO, "OPERATOR")).toBe(true);
  });

  it("A TRAVA D1 tambem no remover: outro subtime, nao", () => {
    expect(podeRemoverDoTime(SUP, CRM, "OPERATOR")).toBe(false);
  });

  it("D2: supervisor nao remove par SUPERVISOR nem superior", () => {
    expect(podeRemoverDoTime(SUP, SEO, "SUPERVISOR")).toBe(false);
    expect(podeRemoverDoTime(SUP, SEO, "MANAGER")).toBe(false);
  });

  it("alcance amplo remove qualquer vinculo", () => {
    expect(podeRemoverDoTime(AMPLO, CRM, "SUPERVISOR")).toBe(true);
  });
});

describe("papeisAtribuiveis", () => {
  it("supervisor so oferece OPERATOR", () => {
    expect(papeisAtribuiveis(SUP, false)).toEqual(["OPERATOR"]);
  });

  it("ADMIN ve o papel ADMIN; MANAGER nao", () => {
    expect(papeisAtribuiveis(AMPLO, true)).toContain("ADMIN");
    expect(papeisAtribuiveis(AMPLO, false)).not.toContain("ADMIN");
  });

  it("sem alcance, lista vazia", () => {
    expect(papeisAtribuiveis(NADA, true)).toEqual([]);
  });
});

describe("timesParaAdicionar", () => {
  const times = [time(RAIZ, null), time(SEO), time(CRM)];

  it("supervisor so ve os proprios subtimes", () => {
    expect(timesParaAdicionar(SUP, times).map((t) => t.id)).toEqual([SEO]);
  });

  it("alcance amplo ve o que a tela mandou, sem filtrar", () => {
    expect(timesParaAdicionar(AMPLO, times)).toHaveLength(3);
  });
});

describe("temAcaoPossivel", () => {
  // A LISTA mostra todo mundo (decisao da Camila, 27/07): esconder linha
  // fazia o contador do cabecalho divergir do corpo. O que varia e o botao.

  it("supervisor age sobre quem esta no proprio subtime", () => {
    expect(temAcaoPossivel(SUP, SEO)).toBe(true);
  });

  it("supervisor age sobre quem esta so na raiz (candidato a entrar)", () => {
    expect(temAcaoPossivel(SUP, null)).toBe(true);
  });

  it("A TRAVA D1: sem acao sobre quem esta em OUTRO subtime", () => {
    expect(temAcaoPossivel(SUP, CRM)).toBe(false);
  });

  it("alcance amplo age sobre qualquer um", () => {
    expect(temAcaoPossivel(AMPLO, CRM)).toBe(true);
    expect(temAcaoPossivel(AMPLO, null)).toBe(true);
  });

  it("sem alcance, nenhuma acao", () => {
    expect(temAcaoPossivel(NADA, SEO)).toBe(false);
    expect(temAcaoPossivel(NADA, null)).toBe(false);
  });
});

describe("podeGerenciarAlgo", () => {
  it("liga a secao de gestao para amplo e subtime, nao para nenhum", () => {
    expect(podeGerenciarAlgo(AMPLO)).toBe(true);
    expect(podeGerenciarAlgo(SUP)).toBe(true);
    expect(podeGerenciarAlgo(NADA)).toBe(false);
  });
});
