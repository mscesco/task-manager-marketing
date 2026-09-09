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
  arvoreDoTime,
  cargosQueSePerdem,
  linhasDoTime,
  opcoesDoSeletor,
  subtimesOferecidos,
} from "../telaDoTime";
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

describe("arvoreDoTime", () => {
  it("inclui o próprio time e os netos", () => {
    expect([...arvoreDoTime(MKT, TIMES)].sort()).toEqual(
      [MKT, CRM, SEO, JR].sort(),
    );
  });

  it("de um subtime, só ele e o que está abaixo", () => {
    expect([...arvoreDoTime(SEO, TIMES)].sort()).toEqual([SEO, JR].sort());
  });

  it("não atravessa para a área irmã", () => {
    expect(arvoreDoTime(MKT, TIMES).has(TI)).toBe(false);
  });
});

describe("linhasDoTime", () => {
  it("⭐ quem está SÓ num subtime aparece na tela da área", () => {
    // ⚠️ A regra da §4.2. Sem ela, quem está só no SEO some da tela do
    // Marketing -- e vira gente invisível justamente onde se administra
    // gente.
    const linhas = linhasDoTime(MKT, TIMES, [pessoa("Ana", [[SEO, "OPERATOR"]])]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].cargoAqui).toBeNull();
    expect(linhas[0].subtimes.map((c) => c.team.name)).toEqual(["SEO"]);
  });

  it("traz o CARGO junto da cápsula, e não só o nome do subtime", () => {
    // ⚠️ Sem o cargo a coluna diz ONDE a pessoa está e esconde O QUE ela é,
    // numa tela cujo assunto é permissão.
    const linhas = linhasDoTime(MKT, TIMES, [
      pessoa("Bia", [[SEO, "SUPERVISOR"]]),
    ]);
    expect(linhas[0].subtimes[0].role).toBe("SUPERVISOR");
  });

  it("o vínculo NA PRÓPRIA área vira `cargoAqui`, e não cápsula", () => {
    const linhas = linhasDoTime(MKT, TIMES, [
      pessoa("Cris", [[MKT, "MANAGER"]]),
    ]);
    expect(linhas[0].cargoAqui).toBe("MANAGER");
    expect(linhas[0].subtimes).toEqual([]);
  });

  it("quem não tem vínculo nenhum na árvore NÃO aparece", () => {
    const deOutraArea = pessoa("Zeca", [[TI, "OPERATOR"]], [TI]);
    expect(linhasDoTime(MKT, TIMES, [deOutraArea])).toEqual([]);
  });

  it("⚠️ INATIVO aparece — o que varia é o botão, nunca a presença", () => {
    // ⚠️ A §3.2: esconder linha já causou o defeito de 27/07, com o contador
    // do cabeçalho divergindo do corpo.
    const inativa = { ...pessoa("Dani", [[SEO, "OPERATOR"]]), is_active: false };
    expect(linhasDoTime(MKT, TIMES, [inativa])).toHaveLength(1);
  });

  it("`+N área` conta só áreas DIFERENTES desta", () => {
    const emDuas = pessoa("Eva", [[SEO, "OPERATOR"], [TI, "OPERATOR"]], [MKT, TI]);
    expect(linhasDoTime(MKT, TIMES, [emDuas])[0].outrasAreas).toBe(1);
    // Quem está só nesta não ganha aviso nenhum.
    expect(
      linhasDoTime(MKT, TIMES, [pessoa("Fê", [[SEO, "OPERATOR"]])])[0]
        .outrasAreas,
    ).toBe(0);
  });

  it("na tela de um SUBTIME, o neto vira cápsula", () => {
    const linhas = linhasDoTime(SEO, TIMES, [
      pessoa("Gi", [[SEO, "SUPERVISOR"], [JR, "OPERATOR"]]),
    ]);
    expect(linhas[0].cargoAqui).toBe("SUPERVISOR");
    expect(linhas[0].subtimes.map((c) => c.team.name)).toEqual(["SEO Junior"]);
  });

  it("ordena por nome da pessoa, e as cápsulas por nome do time", () => {
    const linhas = linhasDoTime(MKT, TIMES, [
      pessoa("Zara", [[SEO, "OPERATOR"]]),
      pessoa("Ana", [[SEO, "OPERATOR"], [CRM, "OPERATOR"]]),
    ]);
    expect(linhas.map((l) => l.membro.name)).toEqual(["Ana", "Zara"]);
    expect(linhas[0].subtimes.map((c) => c.team.name)).toEqual(["CRM", "SEO"]);
  });
});

describe("cargosQueSePerdem", () => {
  const supervisora = { team: TIMES[2], role: "SUPERVISOR" as MemberRole };
  const operadora = { team: TIMES[1], role: "OPERATOR" as MemberRole };

  it("⭐⭐ desmarcar quem é SUPERVISOR avisa o que se perde", () => {
    // ⚠️ O defeito silencioso: remarcar depois traz a pessoa de volta como
    // OPERADOR, porque é assim que o vínculo novo nasce. O cargo some sem
    // ninguém dizer nada.
    const perdidos = cargosQueSePerdem([supervisora, operadora], [CRM]);
    expect(perdidos.map((c) => c.team.name)).toEqual(["SEO"]);
  });

  it("⚠️ desmarcar OPERADOR não pede confirmação", () => {
    // ⚠️ Confirmar aqui treinaria a pessoa a clicar em "sim" sem ler -- que é
    // como a confirmação do caso GRAVE também passaria despercebida.
    expect(cargosQueSePerdem([operadora], [])).toEqual([]);
  });

  it("não avisa sobre o que continua marcado", () => {
    expect(cargosQueSePerdem([supervisora], [SEO])).toEqual([]);
  });
});

describe("opcoesDoSeletor", () => {
  it("⭐ quem JÁ está marcado nunca some da lista", () => {
    // ⭐ A regra copiada de `TaskDetail.tsx:726-730`, que a spec manda copiar.
    // ⚠️ Sem ela, salvar o seletor removeria em silêncio um vínculo que você
    // não via -- e o defeito só apareceria dias depois.
    const foraDoEscopo = { team: TIMES[4], role: "OPERATOR" as MemberRole };
    const opcoes = opcoesDoSeletor(subtimesOferecidos(MKT, TIMES), [
      foraDoEscopo,
    ]);
    expect(opcoes.map((t) => t.name)).toContain("TI");
  });

  it("não duplica quem já está entre os oferecidos", () => {
    const jaOferecido = { team: TIMES[2], role: "SUPERVISOR" as MemberRole };
    const opcoes = opcoesDoSeletor(subtimesOferecidos(MKT, TIMES), [
      jaOferecido,
    ]);
    expect(opcoes.filter((t) => t.id === SEO)).toHaveLength(1);
  });
});

describe("subtimesOferecidos", () => {
  it("oferece a árvore abaixo, sem o próprio time", () => {
    expect(subtimesOferecidos(MKT, TIMES).map((t) => t.name)).toEqual([
      "CRM",
      "SEO",
      "SEO Junior",
    ]);
  });

  it("não oferece time de outra área", () => {
    expect(subtimesOferecidos(MKT, TIMES).map((t) => t.id)).not.toContain(TI);
  });
});
