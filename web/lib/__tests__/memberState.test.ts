/**
 * Os três estados da aba de pessoas. Não existe fluxo de convite: "convidado"
 * é derivado, e estes testes garantem que os estados sejam uma PARTIÇÃO (soma
 * dos três igual ao total, ninguém em dois lugares, ninguém de fora).
 */

import { describe, it, expect } from "vitest";
import {
  countByState,
  memberState,
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
    // Desativado antes de entrar tem `must_change_password` true e
    // `is_active` false; não pode aparecer entre os convidados.
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
    // Quem ficasse de fora faria o contador divergir da lista.
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
