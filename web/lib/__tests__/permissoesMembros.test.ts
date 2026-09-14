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
  avisoDeRebaixamento,
  papeisAtribuiveis,
  timesParaAdicionar,
  candidatosParaAdicionar,
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
    const a = alcanceDe({ permissions: ["membership.update"], teams: [] });
    expect(a.tipo).toBe("amplo");
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
      permissions: ["membership.create", "membership.update"],
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

const NA_RAIZ = true;
const EM_SUBTIME = false;

describe("papeisAtribuiveis", () => {
  it("supervisor so oferece OPERATOR", () => {
    expect(papeisAtribuiveis(SUP, false, EM_SUBTIME)).toEqual(["OPERATOR"]);
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

describe("avisoDeRebaixamento", () => {
  it("papel igual -> sem aviso (o caso normal)", () => {
    expect(avisoDeRebaixamento("OPERATOR", "OPERATOR", "Marketing")).toBeNull();
  });

  it("supervisor que virou operador -> avisa, com os dois papeis e o time", () => {
    const aviso = avisoDeRebaixamento("SUPERVISOR", "OPERATOR", "Marketing");
    expect(aviso).toContain("Supervisor");
    expect(aviso).toContain("Operador");
    expect(aviso).toContain("Marketing");
  });

  // ⚠️ A FUNCAO COMPARA, e nao reimplementa a regra do backend. Se o mapa de
  // rebaixamento mudar la, a tela continua contando a verdade sem ser tocada
  // -- e este teste e o que registra essa escolha.
  it("avisa qualquer troca, e nao so a que existe hoje", () => {
    expect(
      avisoDeRebaixamento("MANAGER", "OPERATOR", "Marketing"),
    ).not.toBeNull();
  });
});

describe("candidatosParaAdicionar", () => {
  const times = [time(RAIZ, null), time(SEO), time(CRM)];

  it("⭐ Spec 044 fatia 3: quem ja tem um subtime pode receber outro", () => {
    // O caso da redatora: ja esta em SEO, e CRM tem de continuar na lista.
    // ⚠️ ATE A FATIA 3 ISTO ERA `[RAIZ]` -- o segundo subtime era filtrado
    // aqui porque o backend devolvia 422. Este teste e o guardiao da
    // ausencia daquele filtro; se alguem o reintroduzir, ele cai.
    const oferecidos = candidatosParaAdicionar(times, [{ team_id: SEO }]);
    expect(oferecidos.map((t) => t.id)).toEqual([RAIZ, CRM]);
  });

  it("nao oferece time onde a pessoa ja esta (seria 409)", () => {
    const oferecidos = candidatosParaAdicionar(times, [
      { team_id: SEO },
      { team_id: CRM },
    ]);
    expect(oferecidos.map((t) => t.id)).toEqual([RAIZ]);
  });

  it("sem vinculo nenhum, oferece tudo", () => {
    expect(candidatosParaAdicionar(times, [])).toHaveLength(3);
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

describe("podeGerenciarAlgo", () => {
  it("liga a secao de gestao para amplo e subtime, nao para nenhum", () => {
    expect(podeGerenciarAlgo(AMPLO)).toBe(true);
    expect(podeGerenciarAlgo(SUP)).toBe(true);
    expect(podeGerenciarAlgo(NADA)).toBe(false);
  });
});
