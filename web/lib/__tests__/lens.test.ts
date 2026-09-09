/**
 * `computeLens` -- a lente de time do front (quais quadros aparecem no menu).
 *
 * ⚠️⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO EM PRODUCAO, em 09/09/2026, e a
 * primeira coisa a registrar e que ele NAO EXISTIA. `computeLens` decide o
 * menu inteiro, mora em `lib/` (que o vitest cobre) e nao tinha um guardiao
 * sequer -- por isso a regressao abaixo subiu sem nada ficar vermelho.
 *
 * O DEFEITO: a conta de administracao da Camila ficou sem vinculo de time
 * nenhum (passo 2 da Spec 045, fatia B) e o menu parou de mostrar os quadros
 * dos subtimes. So o "Quadro geral" sobrou.
 *
 * A CAUSA: a funcao derivava tudo de `me.teams`. Sem vinculos, o laco nao
 * roda, e a lente sai vazia.
 *
 * ⚠️ E O `/auth/me` AFIRMAVA QUE ISSO NAO ACONTECERIA: *"Assim a fatia B nao
 * exige mudanca nenhuma no front."* Verdade para `alcanceDe`, que le
 * `permissions`; falso para esta funcao. O papel de organizacao SEMPRE esteve
 * em `me.roles` -- faltava alguem olhar.
 */

import { describe, it, expect } from "vitest";
import { computeLens } from "../lens";
import type { Team, TeamMembership } from "../api";

const RAIZ = "t-raiz";
const SEO = "t-seo";
const CRM = "t-crm";

function time(id: string, nome: string, parent: string | null): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: parent,
    name: nome,
    slug: id,
  };
}

const TIMES: Team[] = [
  time(RAIZ, "Marketing", null),
  time(SEO, "SEO", RAIZ),
  time(CRM, "CRM", RAIZ),
];

function vinculo(team_id: string, role: string): TeamMembership {
  return { team_id, role } as TeamMembership;
}

describe("computeLens -- admin de ORGANIZACAO, sem vinculo nenhum", () => {
  it("⭐⭐ enxerga todos os subtimes -- a regressao de 09/09", () => {
    // ⚠️ ESTE E O ESTADO REAL DA CONTA DE ADMINISTRACAO EM PRODUCAO desde o
    // passo 2: papel na organizacao, zero linhas em `user_team`.
    const lens = computeLens([], TIMES, ["ADMIN"]);

    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual(
      [CRM, SEO].sort(),
    );
    expect(lens.visibleTeamIds.has(SEO)).toBe(true);
    expect(lens.visibleTeamIds.has(CRM)).toBe(true);
  });

  it("⚠️ e SEM o papel a lente sai VAZIA -- o defeito, preservado", () => {
    // A mesma pessoa, sem a terceira parcela: e exatamente o que a tela
    // mostrava. Manter este caso e o que impede alguem de "simplificar" a
    // assinatura de volta.
    const lens = computeLens([], TIMES, []);

    expect(lens.boardSubteams).toEqual([]);
    expect(lens.visibleTeamIds.size).toBe(0);
  });

  it("a raiz continua sendo resolvida mesmo sem vinculo", () => {
    expect(computeLens([], TIMES, ["ADMIN"]).rootId).toBe(RAIZ);
  });
});

describe("computeLens -- o que NAO pode mudar", () => {
  it("⚠️ MANAGER ve a arvore DELE, e nao tudo", () => {
    // ⚠️ O GUARDIAO CONTRA O CONSERTO PREGUICOSO. Derivar "ve tudo" de
    // `permissions` (um MANAGER tambem tem `team.manage`) faria este teste
    // continuar passando HOJE -- e quebrar o escopo dele no dia da segunda
    // area, quando ele passaria a ver os subtimes do TI.
    const lens = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, ["MANAGER"]);
    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual(
      [CRM, SEO].sort(),
    );
  });

  it("OPERATOR de um subtime ve o subtime dele + a raiz", () => {
    const lens = computeLens([vinculo(SEO, "OPERATOR")], TIMES, ["OPERATOR"]);
    expect(lens.boardSubteams.map((t) => t.id)).toEqual([SEO]);
    expect(lens.visibleTeamIds.has(RAIZ)).toBe(true);
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("SUPERVISOR de um subtime NAO ve o subtime irmao", () => {
    const lens = computeLens(
      [vinculo(SEO, "SUPERVISOR")],
      TIMES,
      ["SUPERVISOR"],
    );
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("as sub-abas vem ordenadas por nome (pt-BR)", () => {
    // CRM antes de SEO -- e a ordem tem de ser a mesma nos dois caminhos,
    // senao o menu muda de ordem conforme quem esta olhando.
    const doAdmin = computeLens([], TIMES, ["ADMIN"]);
    const doManager = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, []);
    expect(doAdmin.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
    expect(doManager.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
  });

  it("o vinculo ADMIN LEGADO continua enxergando tudo", () => {
    // ⚠️ Ate 08/09 a Camila tinha `user_team.role = 'ADMIN'`. Bases que nao
    // passaram pela limpeza manual da `0022` ainda tem linhas assim, e elas
    // chegam aqui pelo `roles` do mesmo jeito -- o `/auth/me` junta as duas
    // parcelas antes de responder.
    const lens = computeLens([vinculo(RAIZ, "ADMIN")], TIMES, ["ADMIN"]);
    expect(lens.boardSubteams).toHaveLength(2);
  });
});
