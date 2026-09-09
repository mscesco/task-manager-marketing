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
  contagemPorEstado,
  estadoDoMembro,
  filtraPorAba,
} from "../estadoDoMembro";
import type { Member } from "../api";

function pessoa(
  nome: string,
  opts: { ativo?: boolean; trocouSenha?: boolean } = {},
): Member {
  return {
    id: `u-${nome}`,
    workspace_id: "ws",
    name: nome,
    email: `${nome}@t.dev`,
    is_active: opts.ativo ?? true,
    must_change_password: !(opts.trocouSenha ?? true),
    team_ids: [],
  };
}

const ATIVA = pessoa("ativa");
const CONVIDADA = pessoa("convidada", { trocouSenha: false });
const INATIVA = pessoa("inativa", { ativo: false });

describe("estadoDoMembro", () => {
  it("quem já entrou é ATIVO", () => {
    expect(estadoDoMembro(ATIVA)).toBe("ativo");
  });

  it("⭐ quem recebeu senha provisória e não entrou é CONVIDADO", () => {
    expect(estadoDoMembro(CONVIDADA)).toBe("convidado");
  });

  it("⚠️ INATIVO ganha dos outros dois", () => {
    // ⚠️ Alguém desativado ANTES de entrar tem `must_change_password` true e
    // `is_active` false. Se "convidado" viesse primeiro, essa pessoa apareceria
    // entre os convidados -- convidando a cobrar um acesso que não vai
    // acontecer, porque a conta não vale mais.
    const desativadaAntesDeEntrar = pessoa("x", {
      ativo: false,
      trocouSenha: false,
    });
    expect(estadoDoMembro(desativadaAntesDeEntrar)).toBe("inativo");
  });

  it("trata a ausência do campo como 'já entrou'", () => {
    // Respostas de mutação não resolvem o campo; a tela não pode classificar
    // meia organização como convidada por causa disso.
    const semCampo = { ...ATIVA, must_change_password: undefined } as Member;
    expect(estadoDoMembro(semCampo)).toBe("ativo");
  });
});

describe("contagemPorEstado", () => {
  it("⭐ é uma PARTIÇÃO: a soma dos três é o total", () => {
    // ⚠️ A §3.2 registra o defeito de 27/07 -- contador divergindo do corpo.
    // Uma classificação que deixasse alguém de fora reproduziria isso.
    const todos = [ATIVA, CONVIDADA, INATIVA, pessoa("outra")];
    const c = contagemPorEstado(todos);
    expect(c.ativo + c.convidado + c.inativo).toBe(todos.length);
    expect(c).toEqual({ ativo: 2, convidado: 1, inativo: 1 });
  });

  it("lista vazia conta zero em tudo, sem quebrar", () => {
    expect(contagemPorEstado([])).toEqual({
      ativo: 0,
      convidado: 0,
      inativo: 0,
    });
  });
});

describe("filtraPorAba", () => {
  const todos = [ATIVA, CONVIDADA, INATIVA];

  it("cada aba traz só o seu estado", () => {
    expect(filtraPorAba(todos, "ativo")).toEqual([ATIVA]);
    expect(filtraPorAba(todos, "convidado")).toEqual([CONVIDADA]);
    expect(filtraPorAba(todos, "inativo")).toEqual([INATIVA]);
  });

  it("⚠️ `todos` NÃO é o mesmo que `ativo`", () => {
    // ⚠️ Confundir os dois é como o inativo some da tela sem ninguém decidir
    // que ele deveria sumir.
    expect(filtraPorAba(todos, "todos")).toHaveLength(3);
  });

  it("não muta a lista recebida", () => {
    const original = [...todos];
    filtraPorAba(todos, "todos").push(pessoa("intrusa"));
    expect(todos).toEqual(original);
  });
});
