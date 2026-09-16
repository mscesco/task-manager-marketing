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
    const lens = computeLens([], TIMES, ["ADMIN"], RAIZ);

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
    const lens = computeLens([], TIMES, [], RAIZ);

    expect(lens.boardSubteams).toEqual([]);
    expect(lens.visibleTeamIds.size).toBe(0);
  });

  it("a raiz e a que veio de fora, e nao a que a lista trouxe primeiro", () => {
    expect(computeLens([], TIMES, ["ADMIN"], RAIZ).rootId).toBe(RAIZ);
  });

  it("⭐ Spec 051, fatia F: o GESTOR sem vinculo tambem ve tudo", () => {
    // ⚠️ O defeito: um GESTOR sem time abria o quadro e lia "Voce nao tem
    // acesso ao quadro deste time", sobre um quadro que o servidor entrega
    // (a lente do backend abre para todo papel de organizacao desde a 049).
    const lens = computeLens([], TIMES, ["GESTOR"], RAIZ);

    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual([CRM, SEO].sort());
    expect(lens.visibleTeamIds.has(RAIZ)).toBe(true);
    expect(lens.visibleTeamIds.has(SEO)).toBe(true);
  });
});

describe("computeLens -- o que NAO pode mudar", () => {
  it("⚠️ MANAGER ve a arvore DELE, e nao tudo", () => {
    // ⚠️ O GUARDIAO CONTRA O CONSERTO PREGUICOSO. Derivar "ve tudo" de
    // `permissions` (um MANAGER tambem tem `team.manage`) faria este teste
    // continuar passando HOJE -- e quebrar o escopo dele no dia da segunda
    // area, quando ele passaria a ver os subtimes do TI.
    const lens = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, ["MANAGER"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.id).sort()).toEqual(
      [CRM, SEO].sort(),
    );
  });

  it("OPERATOR de um subtime ve o subtime dele + a raiz", () => {
    const lens = computeLens([vinculo(SEO, "OPERATOR")], TIMES, ["OPERATOR"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.id)).toEqual([SEO]);
    expect(lens.visibleTeamIds.has(RAIZ)).toBe(true);
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("SUPERVISOR de um subtime NAO ve o subtime irmao", () => {
    const lens = computeLens(
      [vinculo(SEO, "SUPERVISOR")],
      TIMES,
      ["SUPERVISOR"],
      RAIZ,
    );
    expect(lens.visibleTeamIds.has(CRM)).toBe(false);
  });

  it("as sub-abas vem ordenadas por nome (pt-BR)", () => {
    // CRM antes de SEO -- e a ordem tem de ser a mesma nos dois caminhos,
    // senao o menu muda de ordem conforme quem esta olhando.
    const doAdmin = computeLens([], TIMES, ["ADMIN"], RAIZ);
    const doManager = computeLens([vinculo(RAIZ, "MANAGER")], TIMES, [], RAIZ);
    expect(doAdmin.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
    expect(doManager.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);
  });

  it("o vinculo ADMIN LEGADO continua enxergando tudo", () => {
    // ⚠️ Ate 08/09 a Camila tinha `user_team.role = 'ADMIN'`. Bases que nao
    // passaram pela limpeza manual da `0022` ainda tem linhas assim, e elas
    // chegam aqui pelo `roles` do mesmo jeito -- o `/auth/me` junta as duas
    // parcelas antes de responder.
    const lens = computeLens([vinculo(RAIZ, "ADMIN")], TIMES, ["ADMIN"], RAIZ);
    expect(lens.boardSubteams).toHaveLength(2);
  });
});

describe("computeLens -- o recorte por TIME ATIVO (Spec 048, fatia B)", () => {
  // ⚠️ Um mundo com DUAS raizes, que e o que a Spec 046 tornou possivel e o
  // que este arquivo nao tinha. O defeito 3.2 só existe aqui.
  const COM = "t-com";
  const VENDAS = "t-vendas";
  const DOIS: Team[] = [
    ...TIMES,
    time(COM, "Comercial", null),
    time(VENDAS, "Vendas", COM),
  ];

  it("⚠️⚠️ o ADMIN vê os subtimes DO TIME ATIVO, e não a árvore inteira", () => {
    // ⚠️⚠️ ERA ESTE O DEFEITO: `boardSubteams` para um ADMIN eram TODOS os
    // subtimes de TODOS os times, e o menu listava "CRM", "SEO" e "Vendas"
    // juntos, sem dizer de quem era cada um.
    const noMkt = computeLens([], DOIS, ["ADMIN"], RAIZ);
    expect(noMkt.boardSubteams.map((t) => t.name)).toEqual(["CRM", "SEO"]);

    const noCom = computeLens([], DOIS, ["ADMIN"], COM);
    expect(noCom.boardSubteams.map((t) => t.name)).toEqual(["Vendas"]);
  });

  it("⚠️ trocar de time ativo TROCA o menu -- a promessa do seletor", () => {
    // O seletor do rodapé existe desde a Spec 047 e não mudava tela nenhuma.
    // Este teste é a promessa dele, afirmada.
    const a = computeLens([], DOIS, ["ADMIN"], RAIZ).boardSubteams;
    const b = computeLens([], DOIS, ["ADMIN"], COM).boardSubteams;
    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
  });

  it("⚠️ o MANAGER de um time não vê subtime do outro, nem com ele ativo", () => {
    // Ele não alcança o Comercial: com o Comercial ativo, o menu fica VAZIO --
    // e não com os subtimes dele. O recorte por time e a lente se somam; um
    // não substitui o outro.
    const lens = computeLens([vinculo(RAIZ, "MANAGER")], DOIS, ["MANAGER"], COM);
    expect(lens.boardSubteams).toEqual([]);
  });

  it("⚠️ `rootId` é o time ativo -- é dele que sai o link do Quadro geral", () => {
    expect(computeLens([], DOIS, ["ADMIN"], COM).rootId).toBe(COM);
  });

  it("⚠⚠ sem time ativo, o menu fica VAZIO -- falha fechada", () => {
    // ⚠️ `null` devolve vazio e não "todos". Um menu com a árvore inteira é
    // exatamente o defeito que o recorte veio matar, e devolver tudo no caso
    // duvidoso seria reintroduzi-lo pela porta do fallback.
    expect(computeLens([], DOIS, ["ADMIN"], null).boardSubteams).toEqual([]);
    expect(computeLens([], DOIS, ["ADMIN"], null).rootId).toBeNull();
  });

  it("subtime de NETO conta como do time raiz", () => {
    // A árvore tem três níveis: um neto pertence ao time raiz do avô.
    const NETO = "t-neto";
    const tres = [...DOIS, time(NETO, "SEO Junior", SEO)];
    const lens = computeLens([], tres, ["ADMIN"], RAIZ);
    expect(lens.boardSubteams.map((t) => t.name)).toEqual([
      "CRM",
      "SEO",
      "SEO Junior",
    ]);
  });
});
