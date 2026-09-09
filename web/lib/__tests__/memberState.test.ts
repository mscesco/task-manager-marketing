/**
 * Spec 047 (revisão de 09/09) — os três estados da aba de pessoas.
 *
 * ⚠️ "Convidado" foi a peça que exigiu conferir o backend antes de desenhar:
 * não existe fluxo de convite neste produto. O estado é derivado, e estes
 * testes são o que garante que ele continue sendo uma PARTIÇÃO — soma dos
 * três igual ao total, ninguém em dois lugares, ninguém de fora.
 */

import { describe, it, expect } from "vitest";
import {
  countByState,
  memberState,
  filterByState,
} from "../memberState";
import type { Member } from "../api";

function pessoa(
  nome: string,
  opts: { active?: boolean; changedPassword?: boolean } = {},
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: `${nome}@t.dev`,
    is_active: opts.active ?? true,
    must_change_password: !(opts.changedPassword ?? true),
    team_ids: [],
  };
}

const ATIVA = pessoa("ativa");
const CONVIDADA = pessoa("convidada", { changedPassword: false });
const INATIVA = pessoa("inativa", { active: false });

describe("memberState", () => {
  it("quem já entrou é ATIVO", () => {
    expect(memberState(ATIVA)).toBe("active");
  });

  it("⭐ quem recebeu senha provisória e não entrou é CONVIDADO", () => {
    expect(memberState(CONVIDADA)).toBe("invited");
  });

  it("⚠️ INATIVO ganha dos outros dois", () => {
    // ⚠️ Alguém desativado ANTES de entrar tem `must_change_password` true e
    // `is_active` false. Se "invited" viesse primeiro, essa pessoa apareceria
    // entre os convidados -- convidando a cobrar um acesso que não vai
    // acontecer, porque a conta não vale mais.
    const desativadaAntesDeEntrar = pessoa("x", {
      active: false,
      changedPassword: false,
    });
    expect(memberState(desativadaAntesDeEntrar)).toBe("inactive");
  });

  it("trata a ausência do campo como 'já entrou'", () => {
    // Respostas de mutação não resolvem o campo; a tela não pode classificar
    // meia organização como convidada por causa disso.
    const semCampo = { ...ATIVA, must_change_password: undefined } as Member;
    expect(memberState(semCampo)).toBe("active");
  });
});

describe("countByState", () => {
  it("⭐ é uma PARTIÇÃO: a soma dos três é o total", () => {
    // ⚠️ A §3.2 registra o defeito de 27/07 -- contador divergindo do corpo.
    // Uma classificação que deixasse alguém de fora reproduziria isso.
    const todos = [ATIVA, CONVIDADA, INATIVA, pessoa("outra")];
    const c = countByState(todos);
    expect(c.active + c.invited + c.inactive).toBe(todos.length);
    expect(c).toEqual({ active: 2, invited: 1, inactive: 1 });
  });

  it("lista vazia conta zero em tudo, sem quebrar", () => {
    expect(countByState([])).toEqual({
      active: 0,
      invited: 0,
      inactive: 0,
    });
  });
});

describe("filterByState", () => {
  const todos = [ATIVA, CONVIDADA, INATIVA];

  it("cada aba traz só o seu estado", () => {
    expect(filterByState(todos, "active")).toEqual([ATIVA]);
    expect(filterByState(todos, "invited")).toEqual([CONVIDADA]);
    expect(filterByState(todos, "inactive")).toEqual([INATIVA]);
  });

  it("⚠️ `todos` NÃO é o mesmo que `ativo`", () => {
    // ⚠️ Confundir os dois é como o inativo some da tela sem ninguém decidir
    // que ele deveria sumir.
    expect(filterByState(todos, "all")).toHaveLength(3);
  });

  it("não muta a lista recebida", () => {
    const original = [...todos];
    filterByState(todos, "all").push(pessoa("intrusa"));
    expect(todos).toEqual(original);
  });
});
