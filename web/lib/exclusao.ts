import { plural } from "@/lib/plural";

/** Regras da exclusão de tarefa. */

/**
 * Texto do aviso após excluir. `cascadeCount` é o número de filhas apagadas
 * junto, sem a raiz; zero não vira "e 0 subtarefas".
 */
export function mensagemExclusao(titulo: string, cascadeCount: number): string {
  if (cascadeCount <= 0) return `"${titulo}" excluída.`;
  return `"${titulo}" e ${plural(cascadeCount, "subtarefa", "subtarefas")} excluídas.`;
}
