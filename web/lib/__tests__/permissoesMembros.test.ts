/**
 * Regras de gestão de membros no front. Espelham as do backend
 * (test_supervisor_member_scope_db.py): se um lado mudar sem o outro, a tela
 * oferece botão que o servidor recusa com 403, ou esconde ação possível.
 * A trava que mais importa: supervisor não alcança outro subtime.
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

  it("trocar cargo NAO faz o supervisor virar amplo", () => {
    // O supervisor tem `membership.update` no próprio subtime. Se esse verbo
    // marcasse "amplo", ele ganharia botão de gestão em todo time (403).
    const a = alcanceDe({
      permissions: ["membership.create", "membership.update", "membership.delete"],
      teams: [{ team_id: SEO, role: "SUPERVISOR" }],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("alcance de subtime: só entram os times onde o papel é SUPERVISOR", () => {
    const a = alcanceDe({
      permissions: ["membership.create"],
      teams: [
        { team_id: SEO, role: "SUPERVISOR" },
        { team_id: RAIZ, role: "OPERATOR" },
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

describe("acoes que NAO sao do supervisor", () => {
  it.each([
    ["cadastrar membro", podeCadastrarMembro],
    ["mover de subtime", podeMoverSubtime],
  ])("%s: so alcance amplo", (_nome, fn) => {
    expect(fn(AMPLO)).toBe(true);
    expect(fn(SUP)).toBe(false);
    expect(fn(NADA)).toBe(false);
  });
});

describe("podeRemoverDoTime", () => {
  // Quem tem o verbo: ADMIN, MANAGER e SUPERVISOR.
  const TIRA = ["membership.create", "membership.delete"] as const;

  it("supervisor remove OPERATOR do proprio subtime", () => {
    expect(podeRemoverDoTime(SUP, SEO, "OPERATOR", TIRA)).toBe(true);
  });

  it("outro subtime, nao", () => {
    expect(podeRemoverDoTime(SUP, CRM, "OPERATOR", TIRA)).toBe(false);
  });

  it("supervisor tira outro SUPERVISOR do proprio subtime, e nao superior", () => {
    expect(podeRemoverDoTime(SUP, SEO, "SUPERVISOR", TIRA)).toBe(true);
    expect(podeRemoverDoTime(SUP, CRM, "SUPERVISOR", TIRA)).toBe(false);
    expect(podeRemoverDoTime(SUP, SEO, "MANAGER", TIRA)).toBe(false);
  });

  it("alcance amplo remove qualquer vinculo", () => {
    expect(podeRemoverDoTime(AMPLO, CRM, "SUPERVISOR", TIRA)).toBe(true);
  });

  it("GESTOR: alcance AMPLO e mesmo assim NAO tira do time", () => {
    // Amplo porque move entre subtimes (`membership.move`); o verbo de tirar
    // ele não tem, e "amplo" sozinho diria sim a um botão que dá 403.
    const GESTOR = ["membership.create", "membership.update", "membership.move"] as const;
    expect(podeRemoverDoTime(AMPLO, CRM, "OPERATOR", GESTOR)).toBe(false);
  });
});

const NA_RAIZ = true;
const EM_SUBTIME = false;

describe("papeisAtribuiveis", () => {
  it("supervisor oferece SUPERVISOR e OPERADOR no subtime, e nada na raiz", () => {
    expect(papeisAtribuiveis(SUP, false, EM_SUBTIME)).toEqual([
      "SUPERVISOR",
      "OPERATOR",
    ]);
    expect(papeisAtribuiveis(SUP, false, NA_RAIZ)).toEqual([]);
  });

  // Os dois toEqual abaixo fixam a lista: ADMIN (papel de organização),
  // MANAGER em subtime e SUPERVISOR na raiz dariam 409 ao salvar.
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
  // A lista mostra todo mundo (esconder linha faria o contador divergir do
  // corpo); o que varia é o botão.

  it("supervisor age sobre quem esta no proprio subtime", () => {
    expect(temAcaoPossivel(SUP, [SEO])).toBe(true);
  });

  it("supervisor age sobre quem esta so na raiz (candidato a entrar)", () => {
    // Lista vazia é o "só na raiz".
    expect(temAcaoPossivel(SUP, [])).toBe(true);
  });

  it("sem acao sobre quem esta em OUTRO subtime", () => {
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

  // A pessoa em mais de um subtime.
  it("⚠️ ALGUM subtime basta: age sobre quem esta no dele E em outro", () => {
    expect(temAcaoPossivel(SUP, [SEO, CRM])).toBe(true);
    // E a ordem nao importa: `some` nao e "o primeiro".
    expect(temAcaoPossivel(SUP, [CRM, SEO])).toBe(true);
  });

  it("⚠️ e a trava sobrevive ao plural: dois subtimes ALHEIOS = sem acao", () => {
    expect(temAcaoPossivel(SUP, [CRM, "outro-qualquer"])).toBe(false);
  });
});
