// Lógica da tela `/times/[id]`: quem aparece e como se conta.

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
  roots: string[] = [MKT],
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: `${nome.toLowerCase()}@t.dev`,
    is_active: true,
    root_team_ids: roots,
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

  it("não atravessa para o time raiz irmão", () => {
    expect(teamTree(MKT, TIMES).has(TI)).toBe(false);
  });
});

describe("teamRows", () => {
  it("⭐ quem está SÓ num subtime aparece na tela do time raiz", () => {
    // Sem isto, quem está só no SEO some da tela do Marketing.
    const linhas = teamRows(MKT, TIMES, [pessoa("Ana", [[SEO, "OPERATOR"]])]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].cargoAqui).toBeNull();
    expect(linhas[0].subteams.map((c) => c.team.name)).toEqual(["SEO"]);
  });

  it("traz o CARGO junto da cápsula, e não só o nome do subtime", () => {
    const linhas = teamRows(MKT, TIMES, [
      pessoa("Bia", [[SEO, "SUPERVISOR"]]),
    ]);
    expect(linhas[0].subteams[0].role).toBe("SUPERVISOR");
  });

  it("o vínculo NO PRÓPRIO time vira `cargoAqui`, e não cápsula", () => {
    const linhas = teamRows(MKT, TIMES, [
      pessoa("Cris", [[MKT, "MANAGER"]]),
    ]);
    expect(linhas[0].cargoAqui).toBe("MANAGER");
    expect(linhas[0].subteams).toEqual([]);
  });

  it("quem não tem vínculo nenhum na árvore NÃO aparece", () => {
    const deOutraRaiz = pessoa("Zeca", [[TI, "OPERATOR"]], [TI]);
    expect(teamRows(MKT, TIMES, [deOutraRaiz])).toEqual([]);
  });

  it("⚠️ INATIVO aparece — o que varia é o botão, nunca a presença", () => {
    const inativa = { ...pessoa("Dani", [[SEO, "OPERATOR"]]), is_active: false };
    expect(teamRows(MKT, TIMES, [inativa])).toHaveLength(1);
  });

  it("`+N time` conta só times raiz DIFERENTES deste", () => {
    const emDuas = pessoa("Eva", [[SEO, "OPERATOR"], [TI, "OPERATOR"]], [MKT, TI]);
    expect(teamRows(MKT, TIMES, [emDuas])[0].otherRoots).toBe(1);
    // Quem está só nesta não ganha aviso nenhum.
    expect(
      teamRows(MKT, TIMES, [pessoa("Fê", [[SEO, "OPERATOR"]])])[0]
        .otherRoots,
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
    // `SEO Junior` é neto do Marketing: aparece ao abrir o SEO.
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
    const cards = subteamCards(MKT, TIMES, [
      pessoa("Ana", [[JR, "OPERATOR"]]),
    ]);
    expect(cards.find((c) => c.team.id === SEO)?.pessoas).toBe(1);
  });

  it("⚠️ NÃO conta duas vezes quem está no subtime E no neto", () => {
    // Somar os membros de cada time da árvore diria 2.
    const cards = subteamCards(MKT, TIMES, [
      pessoa("Ana", [
        [SEO, "SUPERVISOR"],
        [JR, "OPERATOR"],
      ]),
    ]);
    expect(cards.find((c) => c.team.id === SEO)?.pessoas).toBe(1);
  });

  it("⚠️ NÃO conta inativo", () => {
    // O cartão resume a gaveta, que não lista inativo.
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
    // A gaveta é de onde se tira alguém; o neto não tem vínculo aqui.
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

  it("estar no NETO não impede entrar no pai", () => {
    // `UNIQUE (user_id, team_id)` só barra o mesmo par.
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
    // Desativada não entra no sistema; o vínculo não serviria para nada.
    const candidatos = subteamCandidates(SEO, [
      pessoa("Ana", [[MKT, "OPERATOR"]]),
      inativa(pessoa("Bia", [[MKT, "OPERATOR"]])),
    ]);
    expect(candidatos.map((m) => m.name)).toEqual(["Ana"]);
  });
});

describe("directMembers e quem está INATIVO", () => {
  it("⭐⭐ não lista quem foi desativado", () => {
    const inativa = { ...pessoa("Bia", [[SEO, "OPERATOR"]]), is_active: false };
    const diretos = directMembers(SEO, [
      pessoa("Ana", [[SEO, "OPERATOR"]]),
      inativa,
    ]);
    expect(diretos.map((d) => d.member.name)).toEqual(["Ana"]);
  });
});
