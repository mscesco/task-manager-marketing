/**
 * Valores iniciais do modal ao duplicar uma tarefa. Datas vêm sempre vazias
 * (a cópia de uma tarefa antiga nasceria vencida e o job de prazo avisaria
 * todas de uma vez); o título leva "Cópia de " sem passar do limite; só
 * entram responsáveis que podem assumir a cópia.
 */

export const PREFIXO_COPIA = "Cópia de ";

/** Mesmo `maxLength` do campo de título no TaskModal e no schema da API. */
export const LIMITE_TITULO = 255;

export type TarefaParaCopiar = {
  title: string;
  description: string;
  priority: string;
  assignee_ids?: string[];
};

export type FilhaParaCopiar = {
  is_archived: boolean;
};

export type ValoresDaCopia = {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[];
  /** Sempre "". O tipo é string para casar com <input type="date">. */
  startDate: string;
  dueDate: string;
  /** Filhas diretas não arquivadas. Alimenta o rótulo da caixa. */
  subtarefasVivas: number;
};

/** Título da cópia. Trunca o título, não o resultado, para o prefixo ficar
 *  inteiro. */
export function tituloDaCopia(titulo: string): string {
  const sobra = LIMITE_TITULO - PREFIXO_COPIA.length;
  return PREFIXO_COPIA + titulo.slice(0, Math.max(0, sobra));
}

/**
 * Monta os valores iniciais do modal em modo cópia. `permitidos` = quem pode
 * ser responsável (lista positiva: quem foi desativado simplesmente não está
 * nela). `filhas` são só as diretas; o front não conhece neto.
 */
export function valoresIniciaisDaCopia(
  origem: TarefaParaCopiar,
  permitidos: Set<string>,
  filhas: FilhaParaCopiar[],
): ValoresDaCopia {
  return {
    title: tituloDaCopia(origem.title),
    description: origem.description,
    priority: origem.priority,
    assigneeIds: (origem.assignee_ids ?? []).filter((id) => permitidos.has(id)),
    startDate: "",
    dueDate: "",
    // Arquivada não é copiada, então não conta.
    subtarefasVivas: filhas.filter((f) => !f.is_archived).length,
  };
}

/** Rótulo da caixa de levar subtarefas. `null` quando não há filha viva. */
export function rotuloCaixaSubtarefas(subtarefasVivas: number): string | null {
  if (subtarefasVivas === 0) return null;
  // "diretas": com netos, chegam mais tarefas do que o número diz.
  return `Levar as subtarefas (${subtarefasVivas} diretas)`;
}
