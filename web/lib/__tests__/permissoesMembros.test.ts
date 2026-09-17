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
  podeCadastrarMembro,
  podeMoverSubtime,
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
  it("mover entre subtimes vira alcance amplo", () => {
    const a = alcanceDe({ permissions: ["membership.move"], teams: [] });
    expect(a.tipo).toBe("amplo");
  });

  it("⚠️ Spec 049, fatia H: trocar cargo NAO faz o supervisor virar amplo", () => {
    // Desde a H o supervisor tem `membership.update` -- no proprio subtime. Se
    // o marcador de "amplo" continuasse sendo esse verbo, ele ganharia botao
    // de gestao em todo time, e cada clique fora do subtime daria 403.
    const a = alcanceDe({
      permissions: ["membership.create", "membership.update", "membership.delete"],
      teams: [{ team_id: SEO, role: "SUPERVISOR" }],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("member.manage.subteam vira alcance de subtime, com os times supervisionados", () => {
    const a = alcanceDe({
      permissions: ["membership.create"],
      teams: [
        { team_id: SEO, role: "SUPERVISOR" },
        { team_id: RAIZ, role: "OPERATOR" },
      ],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("so entra no alcance o time onde o papel e SUPERVISOR", () => {
    const a = alcanceDe({
      permissions: ["membership.create"],
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
      permissions: ["membership.create", "membership.update", "membership.move"],
      teams: [{ team_id: SEO, role: "SUPERVISOR" }],
    });
    expect(a.tipo).toBe("amplo");
  });
});

describe("acoes que a 028 NAO abriu ao supervisor", () => {
  it.each([
    ["cadastrar membro (D3)", podeCadastrarMembro],
    // Resetar senha e desativar conta sairam daqui na Spec 051 (fatia E): o
    // cadeado passou a ser por PESSOA, e vem do servidor.
    ["mover de subtime (D1)", podeMoverSubtime],
  ])("%s: so alcance amplo", (_nome, fn) => {
    expect(fn(AMPLO)).toBe(true);
    expect(fn(SUP)).toBe(false);
    expect(fn(NADA)).toBe(false);
  });
});

describe("podeRemoverDoTime", () => {
  // Quem tem o verbo: ADMIN, MANAGER e SUPERVISOR (Spec 049, fatia A).
  const TIRA = ["membership.create", "membership.delete"] as const;

  it("supervisor remove OPERATOR do proprio subtime", () => {
    expect(podeRemoverDoTime(SUP, SEO, "OPERATOR", TIRA)).toBe(true);
  });

  it("A TRAVA D1 tambem no remover: outro subtime, nao", () => {
    expect(podeRemoverDoTime(SUP, CRM, "OPERATOR", TIRA)).toBe(false);
  });

  // ⚠️ Era "D2: supervisor nao remove par SUPERVISOR" -- revogada na fatia H.
  it("fatia H: supervisor tira outro SUPERVISOR do proprio subtime, e nao superior", () => {
    expect(podeRemoverDoTime(SUP, SEO, "SUPERVISOR", TIRA)).toBe(true);
    expect(podeRemoverDoTime(SUP, CRM, "SUPERVISOR", TIRA)).toBe(false);
    expect(podeRemoverDoTime(SUP, SEO, "MANAGER", TIRA)).toBe(false);
  });

  it("alcance amplo remove qualquer vinculo", () => {
    expect(podeRemoverDoTime(AMPLO, CRM, "SUPERVISOR", TIRA)).toBe(true);
  });

  it("⚠️ GESTOR (Spec 049, fatia D): alcance AMPLO e mesmo assim NAO tira do time", () => {
    // O alcance dele e amplo porque ele move entre subtimes (`membership.move`); o
    // verbo de tirar ele nao tem. Sem o parametro de permissoes, "amplo" dizia
    // sim e o botao dava 403.
    const GESTOR = ["membership.create", "membership.update", "membership.move"] as const;
    expect(podeRemoverDoTime(AMPLO, CRM, "OPERATOR", GESTOR)).toBe(false);
  });
});

const NA_RAIZ = true;
const EM_SUBTIME = false;

describe("papeisAtribuiveis", () => {
  // ⚠️ Era "supervisor so oferece OPERATOR" (D2 da Spec 028), revogada na
  // Spec 049, fatia H: sem SUPERVISOR na lista, a tela escondia a promocao que
  // o servidor passou a aceitar.
  it("fatia H: supervisor oferece SUPERVISOR e OPERADOR no subtime, e nada na raiz", () => {
    expect(papeisAtribuiveis(SUP, false, EM_SUBTIME)).toEqual([
      "SUPERVISOR",
      "OPERATOR",
    ]);
    expect(papeisAtribuiveis(SUP, false, NA_RAIZ)).toEqual([]);
  });

  it("na raiz: GERENTE e OPERADOR", () => {
    expect(papeisAtribuiveis(AMPLO, true, NA_RAIZ)).toEqual([
      "MANAGER",
      "OPERATOR",
    ]);
  });

  it("em subtime: SUPERVISOR e OPERADOR", () => {
    expect(papeisAtribuiveis(AMPLO, true, EM_SUBTIME)).toEqual([
      "SUPERVISOR",
      "OPERATOR",
    ]);
  });

  // ⚠️⚠️ ESTE TESTE AFIRMAVA O CONTRARIO -- "ADMIN ve o papel ADMIN" --, e a
  // Spec 045 (fatia D) o inverteu: ADMIN saiu do nivel de time e virou papel
  // de ORGANIZACAO. Nao e questao de permissao: nao ha time que o aceite,
  // nem para quem e admin. Oferecer levaria a 409 na hora de salvar.
  it("ADMIN nao aparece em nivel de time NENHUM, nem para admin", () => {
    for (const nivel of [NA_RAIZ, EM_SUBTIME]) {
      expect(papeisAtribuiveis(AMPLO, true, nivel)).not.toContain("ADMIN");
      expect(papeisAtribuiveis(AMPLO, false, nivel)).not.toContain("ADMIN");
    }
  });

  // A outra metade da invariante, e a que a tela erraria calada: MANAGER num
  // subtime e SUPERVISOR na raiz sao os dois 409 que sobravam.
  it("MANAGER nao aparece em subtime; SUPERVISOR nao aparece na raiz", () => {
    expect(papeisAtribuiveis(AMPLO, true, EM_SUBTIME)).not.toContain("MANAGER");
    expect(papeisAtribuiveis(AMPLO, true, NA_RAIZ)).not.toContain("SUPERVISOR");
  });

  it("OPERADOR aparece nos dois niveis -- e o unico", () => {
    expect(papeisAtribuiveis(AMPLO, true, NA_RAIZ)).toContain("OPERATOR");
    expect(papeisAtribuiveis(AMPLO, true, EM_SUBTIME)).toContain("OPERATOR");
  });

  it("sem alcance, lista vazia", () => {
    expect(papeisAtribuiveis(NADA, true, NA_RAIZ)).toEqual([]);
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
    expect(temAcaoPossivel(SUP, [SEO])).toBe(true);
  });

  it("supervisor age sobre quem esta so na raiz (candidato a entrar)", () => {
    // ⚠️ LISTA VAZIA e o "so na raiz" -- era `null` ate a Spec 044. O backend
    // passou a ter UMA representacao para "sem subtime", e o teste segue.
    expect(temAcaoPossivel(SUP, [])).toBe(true);
  });

  it("A TRAVA D1: sem acao sobre quem esta em OUTRO subtime", () => {
    expect(temAcaoPossivel(SUP, [CRM])).toBe(false);
  });

  it("alcance amplo age sobre qualquer um", () => {
    expect(temAcaoPossivel(AMPLO, [CRM])).toBe(true);
    expect(temAcaoPossivel(AMPLO, [])).toBe(true);
  });

  it("sem alcance, nenhuma acao", () => {
    expect(temAcaoPossivel(NADA, [SEO])).toBe(false);
    expect(temAcaoPossivel(NADA, [])).toBe(false);
  });

  // =====================================================================
  // ⚠️ Spec 044: a pessoa em MAIS DE UM subtime
  // =====================================================================

  it("⚠️ ALGUM subtime basta: age sobre quem esta no dele E em outro", () => {
    // O caso concreto da ADR 0039: a redatora em SEO e em Midias Sociais. O
    // supervisor de SEO administra a pessoa NAQUELE subtime.
    //
    // ⚠️ ESTE E O TESTE QUE MUDA COMPORTAMENTO, e nao so tipo: com a versao
    // singular a resposta dependia de qual dos dois subtimes o backend tivesse
    // escolhido devolver -- ou seja, era sorteio. Agora e determinado.
    expect(temAcaoPossivel(SUP, [SEO, CRM])).toBe(true);
    // E a ordem nao importa: `some` nao e "o primeiro".
    expect(temAcaoPossivel(SUP, [CRM, SEO])).toBe(true);
  });

  it("⚠️ e a TRAVA D1 sobrevive ao plural: dois subtimes ALHEIOS = sem acao", () => {
    // Se isto virar `true`, o supervisor de SEO ganhou botao sobre gente que
    // nao e dele -- o backend recusaria com 403, mas a tela teria oferecido.
    expect(temAcaoPossivel(SUP, [CRM, "outro-qualquer"])).toBe(false);
  });
});
