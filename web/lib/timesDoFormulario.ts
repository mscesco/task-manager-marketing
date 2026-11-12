// Em quais times a pessoa pode criar formulário de solicitação, e qual vem
// pré-escolhido. A lista vem do servidor (`can_create_form`, a mesma pergunta
// do POST); subtime entra.

import type { Team } from "./api";

/** Os times em que a pessoa pode criar formulario. Ausente = nao pode. */
export function timesQueCriamFormulario(times: readonly Team[]): Team[] {
  return times.filter((t) => t.can_create_form === true);
}

/**
 * O time pré-escolhido: o ativo, se a pessoa cria nele; senão a única raiz em
 * que ela cria; senão nenhum (`""`). Nunca "o primeiro da lista", que com
 * várias raízes seria um sorteio.
 */
export function timePadraoDoFormulario(times: readonly Team[], ativo: string | null): string {
  const podem = timesQueCriamFormulario(times);
  if (ativo && podem.some((t) => t.id === ativo)) return ativo;
  const raizes = podem.filter((t) => t.parent_team_id === null);
  return raizes.length === 1 ? raizes[0].id : "";
}
