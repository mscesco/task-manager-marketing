// web/lib/notificacoes.ts
// =====================================================================
// Para onde uma notificacao leva.
//
// O BUG QUE ISTO CORRIGE
// O sino mandava tudo para `/minhas-tarefas?task=<id>`, sob a premissa
// escrita no proprio componente: "a task sempre esta la, porque o
// destinatario e sempre responsavel dela".
//
// Isso vale para TASK_ASSIGNED. Nao vale para TASK_MENTIONED nem
// TASK_COMMENTED: qualquer pessoa pode ser mencionada numa tarefa de que
// nao e responsavel, e watcher recebe aviso de comentario sem estar
// designado. Nesses casos a tarefa nao esta na lista de atribuicoes, a
// pagina nao acha nada e o clique nao abre coisa alguma.
//
// POR QUE NAO O QUADRO GERAL
// Trocaria um destino que as vezes falha por outro que as vezes falha. O
// quadro geral nao mostra tarefa de subtime, nem arquivada, e -- pelo ADR
// 0004 -- nao mostra SUBTAREFA como card: ela vive dentro do card da mae.
// Mencao em subtarefa arquivada de outro time falharia igual.
//
// `/tarefa/<id>` e a rota canonica: busca por id, sem depender de lista,
// lente ou filtro. Ela ja existia exatamente por isso -- foi criada para
// link compartilhado, que tinha o mesmo problema.
//
// LIMITE CONHECIDO (bug E6, ADR 0002 do front): task `out_of_scope` devolve
// 404 no GET /tasks/{id}. Quem for mencionado numa tarefa fora da propria
// lente cai nesse caso e ve "nao encontrada". E frente de BACKEND, nao se
// resolve escolhendo rota -- nenhum destino do front contorna um 404.
// =====================================================================

/** O minimo que precisamos saber de uma notificacao para achar o destino. */
export type NotificacaoNavegavel = {
  task_id: string | null;
};

/**
 * URL que o clique na notificacao deve abrir.
 *
 * Sem `task_id` (aviso de sistema, sem tarefa associada) cai em
 * `/minhas-tarefas`, que e o painel padrao de quem recebe aviso.
 */
export function destinoDaNotificacao(n: NotificacaoNavegavel): string {
  if (!n.task_id) return "/minhas-tarefas";
  return `/tarefa/${n.task_id}`;
}
