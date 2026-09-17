/**
 * Spec 047, fatia C -- a lógica da tela `/times/[id]`.
 *
 * ⚠️ As duas regras mais delicadas desta fatia são exatamente as que NÃO dão
 * erro quando saem erradas:
 *
 *   quem APARECE      -- errar esconde gente, e ninguém procura o que não vê
 *   o que se PERDE    -- o cargo some do payload antes de sumir do banco
 *
 * A §7 da spec avisa da segunda: *"o seletor devolve uma lista de ids; o
 * cargo que se perde não está nela, e nenhum teste de corpo vai notar a
 * ausência de algo que nunca esteve no payload."*
 */

import { describe, it, expect } from "vitest";
import {
  teamTree,
  subteamCards,
  subteamCandidates,
  teamRows,
  directMembers,
} from "../teamScreen";
import type { Member, MemberRole, Team } from "../api";

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const CRM = "t-crm";
const TI = "t-ti";

function time(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  time(MKT, "Marketing", null),
  time(CRM, "CRM", MKT),
  time(SEO, "SEO", MKT),
  time(JR, "SEO Junior", SEO),
  time(TI, "TI", null),
];

function pessoa(
  nome: string,
  vinculos: [string, MemberRole][],
  areas: string[] = [MKT],
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: `${nome.toLowerCase()}@t.dev`,
    is_active: true,
    area_ids: areas,
    team_ids: [],
    memberships: vinculos.map(([team_id, role]) => ({ team_id, role })),
  };
}

describe("teamTree", () => {
  it("inclui o próprio time e os netos", () => {
    expect([...teamTree(MKT, TIMES)].sort()).toEqual(
      [MKT, CRM, SEO, JR].sort(),
    );
  });

  it("de um subtime, só ele e o que está abaixo", () => {
    expect([...teamTree(SEO, TIMES)].sort()).toEqual([SEO, JR].sort());
  });

  it("não atravessa para a área irmã", () => {
    expect(teamTree(MKT, TIMES).has(TI)).toBe(false);
  });
});

describe("teamRows", () => {
  it("⭐ quem está SÓ num subtime aparece na tela da área", () => {
    // ⚠️ A regra da §4.2. Sem ela, quem está só no SEO some da tela do
    // Marketing -- e vira gente invisível justamente onde se administra
    // gente.
    const linhas = teamRows(MKT, TIMES, [pessoa("Ana", [[SEO, "OPERATOR"]])]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].cargoAqui).toBeNull();
    expect(linhas[0].subteams.map((c) => c.team.name)).toEqual(["SEO"]);
  });

  it("traz o CARGO junto da cápsula, e não só o nome do subtime", () => {
    // ⚠️ Sem o cargo a coluna diz ONDE a pessoa está e esconde O QUE ela é,
    // numa tela cujo assunto é permissão.
    const linhas = teamRows(MKT, TIMES, [
      pessoa("Bia", [[SEO, "SUPERVISOR"]]),
    ]);
    expect(linhas[0].subteams[0].role).toBe("SUPERVISOR");
  });

  it("o vínculo NA PRÓPRIA área vira `cargoAqui`, e não cápsula", () => {
    const linhas = teamRows(MKT, TIMES, [
      pessoa("Cris", [[MKT, "MANAGER"]]),
    ]);
    expect(linhas[0].cargoAqui).toBe("MANAGER");
    expect(linhas[0].subteams).toEqual([]);
  });

  it("quem não tem vínculo nenhum na árvore NÃO aparece", () => {
    const deOutraArea = pessoa("Zeca", [[TI, "OPERATOR"]], [TI]);
    expect(teamRows(MKT, TIMES, [deOutraArea])).toEqual([]);
  });

  it("⚠️ INATIVO aparece — o que varia é o botão, nunca a presença", () => {
    // ⚠️ A §3.2: esconder linha já causou o defeito de 27/07, com o contador
    // do cabeçalho divergindo do corpo.
    const inativa = { ...pessoa("Dani", [[SEO, "OPERATOR"]]), is_active: false };
    expect(teamRows(MKT, TIMES, [inativa])).toHaveLength(1);
  });

  it("`+N área` conta só áreas DIFERENTES desta", () => {
    const emDuas = pessoa("Eva", [[SEO, "OPERATOR"], [TI, "OPERATOR"]], [MKT, TI]);
    expect(teamRows(MKT, TIMES, [emDuas])[0].outrasAreas).toBe(1);
    // Quem está só nesta não ganha aviso nenhum.
    expect(
      teamRows(MKT, TIMES, [pessoa("Fê", [[SEO, "OPERATOR"]])])[0]
        .outrasAreas,
    ).toBe(0);
  });

  it("na tela de um SUBTIME, o neto vira cápsula", () => {
    const linhas = teamRows(SEO, TIMES, [
      pessoa("Gi", [[SEO, "SUPERVISOR"], [JR, "OPERATOR"]]),
    ]);
    expect(linhas[0].cargoAqui).toBe("SUPERVISOR");
    expect(linhas[0].subteams.map((c) => c.team.name)).toEqual(["SEO Junior"]);
  });

  it("ordena por nome da pessoa, e as cápsulas por nome do time", () => {
    const linhas = teamRows(MKT, TIMES, [
      pessoa("Zara", [[SEO, "OPERATOR"]]),
      pessoa("Ana", [[SEO, "OPERATOR"], [CRM, "OPERATOR"]]),
    ]);
    expect(linhas.map((l) => l.member.name)).toEqual(["Ana", "Zara"]);
    expect(linhas[0].subteams.map((c) => c.team.name)).toEqual(["CRM", "SEO"]);
  });
});

describe("subteamCards", () => {
  it("traz só os filhos DIRETOS, ordenados por nome", () => {
    // ⚠️ `SEO Junior` é neto do Marketing e NÃO entra na grade dele — ele
    // aparece ao abrir o SEO. Misturar os dois níveis numa grade plana
    // esconderia quem é filho de quem, que é o que a visão existe para
    // mostrar.
    expect(subteamCards(MKT, TIMES, []).map((c) => c.team.name)).toEqual([
      "CRM",
      "SEO",
    ]);
  });

  it("conta o neto no número de subtimes do cartão", () => {
    // O neto some da grade, mas o cartão diz que ele existe.
    const cards = subteamCards(MKT, TIMES, []);
    expect(cards.find((c) => c.team.id === SEO)?.subteams).toBe(1);
    expect(cards.find((c) => c.team.id === CRM)?.subteams).toBe(0);
  });

  it("⭐ conta quem está só no NETO como pessoa do subtime", () => {
    // ⚠️ Mesma regra da tabela (§4.2): quem está no SEO Junior pertence à
    // árvore do SEO. Contar só o vínculo direto diria "0 pessoas" num
    // subtime cheio de gente.
    const cards = subteamCards(MKT, TIMES, [
      pessoa("Ana", [[JR, "OPERATOR"]]),
    ]);
    expect(cards.find((c) => c.team.id === SEO)?.pessoas).toBe(1);
  });

  it("⚠️ NÃO conta duas vezes quem está no subtime E no neto", () => {
    // O cadastro normal de quem coordena. Somar os membros de cada time da
    // árvore -- a implementação óbvia -- diria 2.
    const cards = subteamCards(MKT, TIMES, [
      pessoa("Ana", [
        [SEO, "SUPERVISOR"],
        [JR, "OPERATOR"],
      ]),
    ]);
    expect(cards.find((c) => c.team.id === SEO)?.pessoas).toBe(1);
  });

  it("⚠️ NÃO conta inativo — a regra MUDOU em 10/09", () => {
    // ⚠️⚠️ ESTE TESTE AFIRMAVA O CONTRÁRIO ("conta inativo também — o cartão
    // diz o total"), e a inversão é deliberada, não um conserto.
    //
    // O argumento antigo era a §3.2: esconder linha já fez o contador do
    // cabeçalho divergir do corpo (27/07). Ele continua valendo NA TABELA,
    // que é o inventário de pessoas e tem uma aba para inativos.
    //
    // O cartão não é inventário: ele resume o que a GAVETA vai mostrar, e a
    // gaveta deixou de listar inativo por decisão da Camila. Com o cartão
    // contando todo mundo, os dois passaram a discordar na cara dela --
    // *"desenvolvimento aparece somente as 2 pessoas mas no card AINDA está
    // com 3"*. Ou seja: manter esta asserção seria manter o defeito.
    const inativa = { ...pessoa("Bia", [[CRM, "OPERATOR"]]), is_active: false };
    expect(subteamCards(MKT, TIMES, [inativa])[0].pessoas).toBe(0);
  });

  it("subtime vazio mostra zero, e não some da grade", () => {
    const cards = subteamCards(MKT, TIMES, []);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.pessoas === 0)).toBe(true);
  });

  it("time folha não tem cartão nenhum", () => {
    expect(subteamCards(JR, TIMES, [])).toEqual([]);
  });
});

describe("directMembers", () => {
  it("⭐ traz só quem tem vínculo NESTE time — o neto não conta", () => {
    // ⚠️ A diferença para `teamRows`: a tabela responde "quem eu
    // administro a partir daqui" (e o neto conta); a gaveta responde "quem
    // está neste time", e é a lista de onde se TIRA alguém. Oferecer "Tirar"
    // a quem está só no neto removeria um vínculo que não existe.
    const diretos = directMembers(SEO, [
      pessoa("Ana", [[SEO, "SUPERVISOR"]]),
      pessoa("Bia", [[JR, "OPERATOR"]]),
    ]);
    expect(diretos.map((d) => d.member.name)).toEqual(["Ana"]);
  });

  it("traz o cargo DAQUELE vínculo, e não um cargo geral", () => {
    // A mesma pessoa é supervisora no SEO e operadora no neto.
    const diretos = directMembers(JR, [
      pessoa("Ana", [
        [SEO, "SUPERVISOR"],
        [JR, "OPERATOR"],
      ]),
    ]);
    expect(diretos[0].role).toBe("OPERATOR");
  });

  it("ordena por nome", () => {
    const diretos = directMembers(SEO, [
      pessoa("Zara", [[SEO, "OPERATOR"]]),
      pessoa("Ana", [[SEO, "OPERATOR"]]),
    ]);
    expect(diretos.map((d) => d.member.name)).toEqual(["Ana", "Zara"]);
  });

  it("sem `memberships` resolvido, ninguém é direto", () => {
    // Respostas de MUTAÇÃO não resolvem o campo; a gaveta não pode quebrar.
    const semCampo = { ...pessoa("X", []), memberships: undefined } as Member;
    expect(directMembers(SEO, [semCampo])).toEqual([]);
  });
});

describe("subteamCandidates", () => {
  it("⚠️ NÃO oferece quem já está — seria 409 pelo UNIQUE do banco", () => {
    const candidatos = subteamCandidates(SEO, [
      pessoa("Ana", [[SEO, "OPERATOR"]]),
      pessoa("Bia", [[MKT, "OPERATOR"]]),
    ]);
    expect(candidatos.map((m) => m.name)).toEqual(["Bia"]);
  });

  it("⭐ oferece quem está só na ÁREA — é o caso normal", () => {
    // Puxar alguém do time geral para o subtime é a operação de toda semana.
    const candidatos = subteamCandidates(SEO, [
      pessoa("Ana", [[MKT, "OPERATOR"]]),
    ]);
    expect(candidatos).toHaveLength(1);
  });

  it("estar no NETO não impede entrar no pai", () => {
    // ⚠️ São vínculos distintos: `UNIQUE (user_id, team_id)` só barra o mesmo
    // par. Quem está no SEO Junior pode ganhar vínculo no SEO.
    expect(subteamCandidates(SEO, [pessoa("Ana", [[JR, "OPERATOR"]])])).toHaveLength(1);
  });

  it("ordena por nome", () => {
    const candidatos = subteamCandidates(SEO, [
      pessoa("Zara", [[MKT, "OPERATOR"]]),
      pessoa("Ana", [[MKT, "OPERATOR"]]),
    ]);
    expect(candidatos.map((m) => m.name)).toEqual(["Ana", "Zara"]);
  });
});

describe("subteamCandidates e quem está INATIVO", () => {
  function inativa(m: Member): Member {
    return { ...m, is_active: false };
  }

  it("⭐⭐ não oferece pessoa desativada", () => {
    // ⚠️ Relatado na tela em 09/09: *"adicionar membro está mostrando pessoas
    // inativas"*. Desativar desliga a pessoa do sistema inteiro e NÃO há rota
    // de reativar (D5 da Spec 028) — vinculá-la a um time é uma escrita que
    // não serve para nada: o vínculo existe e ela continua sem entrar.
    const candidatos = subteamCandidates(SEO, [
      pessoa("Ana", [[MKT, "OPERATOR"]]),
      inativa(pessoa("Bia", [[MKT, "OPERATOR"]])),
    ]);
    expect(candidatos.map((m) => m.name)).toEqual(["Ana"]);
  });

  it("⚠️ e isto é o CONTRÁRIO da regra da tabela, de propósito", () => {
    // ⚠️ Na tabela, inativo APARECE (§3.2 — esconder linha já fez o contador
    // do cabeçalho divergir do corpo, em 27/07). A diferença é que a tabela
    // INFORMA e o seletor PROPÕE UMA AÇÃO: informar sobre quem saiu é útil;
    // oferecer uma ação sobre quem saiu é oferecer o que não funciona.
    const bia = inativa(pessoa("Bia", [[SEO, "OPERATOR"]]));
    expect(teamRows(SEO, TIMES, [bia])).toHaveLength(1);
    expect(subteamCandidates(JR, [bia])).toEqual([]);
  });
});

describe("directMembers e quem está INATIVO", () => {
  it("⭐⭐ não lista quem foi desativado", () => {
    // ⚠️ Decisão da Camila em 10/09: *"não quero nem que a pessoa apareça aqui
    // se ela está inativa. Os inativos só aparecem na aba de inativos em
    // membros"*. A gaveta é a lista de TRABALHO de um time; quem saiu da
    // empresa não está nela.
    const inativa = { ...pessoa("Bia", [[SEO, "OPERATOR"]]), is_active: false };
    const diretos = directMembers(SEO, [
      pessoa("Ana", [[SEO, "OPERATOR"]]),
      inativa,
    ]);
    expect(diretos.map((d) => d.member.name)).toEqual(["Ana"]);
  });

  it("⚠️ e a TABELA continua mostrando — as duas regras convivem", () => {
    // ⚠️ Não é contradição com a §3.2: a tabela é o INVENTÁRIO de pessoas, e
    // lá esconder faria "8 pessoas" no cabeçalho com 5 linhas no corpo. Ela
    // tem uma aba própria para inativos; a gaveta não.
    const inativa = { ...pessoa("Bia", [[SEO, "OPERATOR"]]), is_active: false };
    expect(teamRows(SEO, TIMES, [inativa])).toHaveLength(1);
    expect(directMembers(SEO, [inativa])).toEqual([]);
  });
});

describe("subteamCards e quem está INATIVO", () => {
  it("⭐⭐ o cartão conta o MESMO que a gaveta lista", () => {
    // ⚠️ Relatado na tela em 10/09: *"desenvolvimento aparece somente as 2
    // pessoas mas no card AINDA está com 3"*. A gaveta passou a filtrar
    // inativo e o cartão não — dois números para a mesma pergunta.
    //
    // ⚠️ Este teste amarra as DUAS funções de propósito: quem mudar uma sem a
    // outra vê o defeito aqui, e não na tela.
    const gente = [
      pessoa("Ana", [[SEO, "OPERATOR"]]),
      pessoa("Bia", [[JR, "OPERATOR"]]),
      { ...pessoa("Zeca", [[SEO, "OPERATOR"]]), is_active: false },
    ];
    const card = subteamCards(MKT, TIMES, gente).find((c) => c.team.id === SEO);
    const naGaveta = directMembers(SEO, gente);

    expect(card?.pessoas).toBe(2); // Ana (SEO) + Bia (neto), sem o Zeca
    // ⚠️ A gaveta é DIRETA (não conta o neto), então os números não são
    // iguais — o que tem de bater é a AUSÊNCIA do inativo nos dois.
    expect(naGaveta.map((d) => d.member.name)).toEqual(["Ana"]);
  });

  it("⚠️ um subtime só de inativos mostra zero, e não some da grade", () => {
    const so = [{ ...pessoa("Zeca", [[SEO, "OPERATOR"]]), is_active: false }];
    const cards = subteamCards(MKT, TIMES, so);
    expect(cards.find((c) => c.team.id === SEO)?.pessoas).toBe(0);
    expect(cards).toHaveLength(2);
  });
});
