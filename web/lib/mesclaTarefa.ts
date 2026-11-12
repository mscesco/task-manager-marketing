/**
 * Mescla a resposta de uma mutação sobre a tarefa em memória. `PATCH`, `/move`
 * e `/archive` respondem `TaskResponse`, sem `assignee_ids` nem os agregados
 * de subtarefa; substituir pela resposta crua apagaria esses campos. Todo
 * ponto de mescla passa por aqui. `??` e não `||`: lista vazia e zero valem.
 */
import type { Task } from "@/lib/api";

export function mesclaTarefa(resposta: Task, anterior: Task | undefined): Task {
  if (!anterior) return resposta;
  return {
    ...resposta,
    assignee_ids: resposta.assignee_ids ?? anterior.assignee_ids,
    subtask_total: resposta.subtask_total ?? anterior.subtask_total,
    subtask_done: resposta.subtask_done ?? anterior.subtask_done,
    subtree_assignee_ids:
      resposta.subtree_assignee_ids ?? anterior.subtree_assignee_ids,
  };
}
