/**
 * Os três estados de uma pessoa na organização — Spec 047, revisão de 09/09.
 *
 * ⚠️⚠️ "CONVIDADO" NÃO É ESTADO NOVO NO BANCO, e isso importa: não há fluxo de
 * convite por e-mail neste produto. Quem é cadastrado recebe uma senha
 * provisória e precisa trocá-la no primeiro acesso (ADR 0020). Então:
 *
 *     inativo    -> is_active = false
 *     convidado  -> ativo E ainda não trocou a senha (nunca entrou)
 *     ativo      -> ativo E já entrou
 *
 * ⚠️ É uma PARTIÇÃO: toda pessoa cai em exatamente um estado, e a soma dos
 * três é o total. A §3.2 registra o defeito de 27/07 — contador do cabeçalho
 * divergindo do corpo — e uma classificação que deixasse alguém de fora
 * reproduziria exatamente isso.
 *
 * FRONTEIRA (Spec 027): mora em `lib/` porque `app/` está fora do `include`
 * do vitest.
 */

import type { Member } from "./api";

export type EstadoDoMembro = "ativo" | "convidado" | "inativo";

/** A aba selecionada. `todos` existe para quem não quer filtrar. */
export type AbaDeMembros = EstadoDoMembro | "todos";

export function estadoDoMembro(membro: Member): EstadoDoMembro {
  // ⚠️ INATIVO GANHA DOS OUTROS DOIS. Alguém desativado antes de entrar é
  // inativo, e não convidado: a conta não vale mais, e mostrá-la entre os
  // convidados convidaria a cobrar um acesso que não vai acontecer.
  if (!membro.is_active) return "inativo";
  return membro.must_change_password ? "convidado" : "ativo";
}

/** Quantas pessoas em cada estado. Alimenta o número ao lado de cada aba. */
export function contagemPorEstado(
  membros: readonly Member[],
): Record<EstadoDoMembro, number> {
  const out: Record<EstadoDoMembro, number> = {
    ativo: 0,
    convidado: 0,
    inativo: 0,
  };
  for (const m of membros) out[estadoDoMembro(m)] += 1;
  return out;
}

/**
 * Filtra pela aba.
 *
 * ⚠️ `todos` devolve a lista inteira, e não é o mesmo que "ativos": a §3.2
 * manda que esconder linha seja sempre visível como escolha. Quem abre a tela
 * numa aba vê o número dela E o total, nunca só o filtrado.
 */
export function filtraPorAba(
  membros: readonly Member[],
  aba: AbaDeMembros,
): Member[] {
  if (aba === "todos") return [...membros];
  return membros.filter((m) => estadoDoMembro(m) === aba);
}
