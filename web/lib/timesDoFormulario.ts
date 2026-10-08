// lib/timesDoFormulario.ts
// Em quais times a pessoa pode criar formulario de solicitacao, e qual vem
// pre-escolhido (08/10).
//
// ⚠️ A LISTA VEM DO SERVIDOR (`can_create_form`, a mesma pergunta do POST).
// Ate 08/10 o campo "Time responsavel" listava TODO time do workspace: o
// gestor do Marketing via o Comercial, escolhia, e ouvia 403 ao salvar.
// Subtime entra -- decisao dela: o formulario de um subtime manda as
// solicitacoes para a fila dele.

import type { Team } from "./api";

/** Os times em que a pessoa pode criar formulario. Ausente = nao pode. */
export function timesQueCriamFormulario(times: readonly Team[]): Team[] {
  return times.filter((t) => t.can_create_form === true);
}

/**
 * O time que o campo traz pre-escolhido: o ATIVO, se a pessoa cria nele; senao
 * a UNICA RAIZ em que ela cria (a reserva de sempre); senao nenhum (`""`) -- e
 * o campo pede a escolha.
 *
 * ⚠️ A RESERVA E A RAIZ, e nao "o unico time": com subtime na lista, quase
 * nunca ha um unico, e o campo viria sempre vazio.
 * ⚠️ NUNCA "o primeiro da lista": com varias raizes, isso era o sorteio que a
 * Spec 046 proibiu -- o formulario nasceria no Comercial enquanto a pessoa
 * olha o Marketing.
 */
export function timePadraoDoFormulario(times: readonly Team[], ativo: string | null): string {
  const podem = timesQueCriamFormulario(times);
  if (ativo && podem.some((t) => t.id === ativo)) return ativo;
  const raizes = podem.filter((t) => t.parent_team_id === null);
  return raizes.length === 1 ? raizes[0].id : "";
}
