// Regras de criação de tarefa e de subtarefa (TaskModal e o formulário rápido
// do TaskDetail): título e responsável obrigatórios, prazo opcional.
// A trava é só do front; o `POST /tasks` aceita sem responsável para não
// travar automação nem a triagem de solicitação.

export type Rascunho = {
  titulo: string;
  assigneeIds: string[];
  dueDate: string; // "" = sem prazo
};

/** Motivo pelo qual ainda nao da pra criar. `null` = pode criar. */
export function motivoNaoCria(r: Rascunho): string | null {
  if (!r.titulo.trim()) return "Escreva o título da subtarefa.";
  if (r.assigneeIds.length === 0) return "Escolha quem vai fazer.";
  return null;
}

export function podeCriar(r: Rascunho): boolean {
  return motivoNaoCria(r) === null;
}

/**
 * O que o Enter no campo de título faz. Com título e sem responsável, leva ao
 * seletor em vez de criar.
 *
 *   "criar"     -> titulo e responsavel prontos
 *   "escolher"  -> titulo pronto, falta responsavel
 *   "nada"      -> titulo vazio (nada a fazer ainda)
 */
export type AcaoDoEnter = "criar" | "escolher" | "nada";

export function acaoDoEnterNoTitulo(r: Rascunho): AcaoDoEnter {
  if (!r.titulo.trim()) return "nada";
  if (r.assigneeIds.length === 0) return "escolher";
  return "criar";
}

/**
 * Depois de criar em sequência o formulário volta vazio, para não designar
 * a pessoa da subtarefa anterior sem querer.
 */
export function proximoDaSequencia(_r: Rascunho): Rascunho {
  // Array novo a cada chamada: uma constante compartilhada seria mutável por
  // qualquer chamador.
  return { titulo: "", assigneeIds: [], dueDate: "" };
}

/** Alterna uma pessoa na seleção (vários responsáveis são permitidos). */
export function alternaResponsavel(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Acrescenta todos os `disponiveis` à seleção, sem tirar ninguém: com busca
 * ativa, `disponiveis` é a lista filtrada.
 */
export function comTodosOsResponsaveis(
  ids: readonly string[],
  disponiveis: readonly string[],
): string[] {
  return Array.from(new Set([...ids, ...disponiveis]));
}

/** Todos os `disponiveis` já estão escolhidos? Lista vazia dá `false`. */
export function todosJaEscolhidos(
  ids: readonly string[],
  disponiveis: readonly string[],
): boolean {
  if (disponiveis.length === 0) return false;
  return disponiveis.every((id) => ids.includes(id));
}

/** Rotulo do botao/resumo da selecao. */
export function resumoResponsaveis(
  ids: readonly string[],
  nomePor: (id: string) => string | undefined
): string {
  if (ids.length === 0) return "Atribuir";
  if (ids.length === 1) return nomePor(ids[0]) ?? "1 pessoa";
  return `${ids.length} pessoas`;
}
