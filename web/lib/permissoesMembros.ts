/**
 * Quem pode administrar quem, na tela de membros. Não é segurança: o backend
 * trava (`MemberService._assert_escopo_supervisor`); aqui só se evita
 * oferecer o botão que daria 403. Mudou a regra lá, mude aqui.
 */

import type { MemberRole, Team } from "./api";
import { alcancePor, type Alcance, type AtorMinimo } from "./alcance";
import type { Permission } from "./permissions.generated";

export type { Alcance, AtorMinimo } from "./alcance";

/**
 * O alcance na gestão de membros. "amplo" é quem move entre subtimes
 * (`membership.move`), não quem troca cargo: o supervisor troca cargo no
 * próprio subtime.
 */
export function alcanceDe(me: AtorMinimo | null | undefined): Alcance {
  return alcancePor(me, "membership.move", "membership.create");
}

// --------------------------------------------------------------------
// Ações que exigem alcance amplo (espelham `_assert_gestao_ampla`).
// Resetar senha e desativar conta dependem do alvo: a gaveta lê
// `GET /members/{id}/account-actions`.
// --------------------------------------------------------------------

/** Cadastrar pessoa nova (dispara senha provisória). */
export function podeCadastrarMembro(a: Alcance): boolean {
  return a.tipo === "amplo";
}

/** Mover entre subtimes toca o subtime de origem. */
export function podeMoverSubtime(a: Alcance): boolean {
  return a.tipo === "amplo";
}

// --------------------------------------------------------------------
// Ações do supervisor no próprio subtime.
// --------------------------------------------------------------------

function ehPapelDeSubtime(papel: MemberRole): boolean {
  return papel === "SUPERVISOR" || papel === "OPERATOR";
}

/**
 * Pode remover este vinculo?
 *
 * `papelAtual` e o papel DAQUELE vinculo, nao o papel geral da pessoa: um
 * OPERATOR na raiz pode ser SUPERVISOR num subtime.
 */
export function podeRemoverDoTime(
  a: Alcance,
  teamId: string,
  papelAtual: MemberRole,
  /** Tirar do time tem verbo próprio (`membership.delete`); o gestor tem
   *  alcance amplo e não o tem. */
  permissoes: readonly Permission[],
): boolean {
  if (!permissoes.includes("membership.delete")) return false;
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  return ehPapelDeSubtime(papelAtual) && a.subtimes.includes(teamId);
}

/**
 * Papéis que o ator pode atribuir naquele time. Supervisor só age em subtime;
 * no nível, a raiz aceita MANAGER e OPERATOR, o subtime SUPERVISOR e
 * OPERATOR. ADMIN é papel de organização, nunca de time.
 */
export function papeisAtribuiveis(
  a: Alcance,
  souAdmin: boolean,
  ehRaiz: boolean,
): MemberRole[] {
  if (a.tipo === "nenhum") return [];
  if (a.tipo === "subtime") return ehRaiz ? [] : ["SUPERVISOR", "OPERATOR"];
  // `souAdmin` hoje não muda a lista; fica na assinatura dos chamadores.
  void souAdmin;
  return ehRaiz ? ["MANAGER", "OPERATOR"] : ["SUPERVISOR", "OPERATOR"];
}

/**
 * Times que a tela deve oferecer no "adicionar a um time".
 *
 * Amplo: os que a tela ja calculou.
 * Supervisor: SO os proprios subtimes -- nunca a raiz, nunca outro subtime.
 */
export function timesParaAdicionar(a: Alcance, times: Team[]): Team[] {
  if (a.tipo === "amplo") return times;
  if (a.tipo === "nenhum") return [];
  return times.filter((t) => a.subtimes.includes(t.id));
}

/**
 * A linha do membro mostra botão? (A lista sempre mostra todo mundo.)
 * Para o supervisor: sim se o membro está em algum subtime dele, ou só na
 * raiz (pode puxá-lo). `subtimesDoMembro` é o `team_ids` do Member, que nunca
 * traz a raiz; vazio = só na raiz.
 */
export function temAcaoPossivel(
  a: Alcance,
  subtimesDoMembro: string[],
): boolean {
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  return (
    subtimesDoMembro.length === 0 ||
    subtimesDoMembro.some((t) => a.subtimes.includes(t))
  );
}
