/**
 * A mescla de uma resposta de mutacao sobre a tarefa que ja estava em memoria.
 *
 * FRONTEIRA (Spec 027): isto e DECISAO, entao mora aqui e nao na tela.
 *
 * ⚠️⚠️ POR QUE EXISTE: `PATCH /tasks/{id}`, `/move` e `/archive` respondem
 * `TaskResponse`, que NAO traz `assignee_ids` (ADR 0025) nem os tres agregados
 * da Spec 042 (`subtask_total`, `subtask_done`, `subtree_assignee_ids`).
 * Substituir a tarefa pela resposta crua APAGA esses campos da memoria ate a
 * proxima listagem.
 *
 * ⚠️ ESTE DEFEITO JA ACONTECEU QUATRO VEZES, sempre igual e sempre num lugar
 * novo:
 *   1. concluir-rapido zerava os responsaveis da subtarefa (ADR 0025);
 *   2. criar tarefa com responsavel nascia sem ninguem no card (27/07);
 *   3. concluir subtarefa apagava a bolinha do responsavel da linha, relatado
 *      na tela em 21/08 -- a B1 moveu a lista de filhas para dentro do
 *      `TaskDetail` e deixou a guarda no quadro;
 *   4. o `aoSalvar` e a resposta do arrasto nunca tiveram a guarda para os
 *      agregados, achados no review da Spec 042.
 *
 * A causa da repeticao nao e distracao: e que a guarda era COPIADA em cada
 * ponto de mescla, e ponto de mescla novo nasce sem ela. Uma funcao so, com
 * teste proprio, e o que impede a quinta vez.
 *
 * ⚠️ `??` E NAO `||`: lista vazia e zero sao respostas legitimas. Com `||`,
 * um card que passou a ter 0 subtarefas herdaria o contador velho para sempre.
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
