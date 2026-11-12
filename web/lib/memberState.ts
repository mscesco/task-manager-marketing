/**
 * Os três estados de uma pessoa na organização. "Convidado" não existe no
 * banco: é quem está ativo e ainda não trocou a senha provisória.
 *
 *     inativo    -> is_active = false
 *     convidado  -> ativo E ainda não trocou a senha (nunca entrou)
 *     ativo      -> ativo E já entrou
 *
 * É uma partição: a soma dos três é o total.
 */

import type { Member } from "./api";

export type MemberState = "active" | "invited" | "inactive";

export function memberState(member: Member): MemberState {
  // Inativo ganha: desativado antes de entrar não é convidado.
  if (!member.is_active) return "inactive";
  return member.must_change_password ? "invited" : "active";
}

/** Quantas pessoas em cada estado. Alimenta o número ao lado de cada aba. */
export function countByState(
  members: readonly Member[],
): Record<MemberState, number> {
  const out: Record<MemberState, number> = {
    active: 0,
    invited: 0,
    inactive: 0,
  };
  for (const m of members) out[memberState(m)] += 1;
  return out;
}
