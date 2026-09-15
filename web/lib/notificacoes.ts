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
// ⚠️ O "bug E6" (ADR 0002 do front) FECHOU na Spec 037 (E5), e nao pelo
// caminho que este comentario previa. Quem e mencionado numa tarefa fora da
// propria lente de time continua vendo "nao encontrada" -- mas isso deixou
// de ser incoerencia: a tarefa tambem nao aparece mais em lista nenhuma.
// Sem alcance, sem tarefa, em todo lugar (ADR 0038, E6).
// =====================================================================

import type { AppNotification } from "./api";

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

/**
 * O texto de uma notificacao no sino.
 *
 * ⚠️ MORAVA DENTRO DO `NotificationBell` e nao tinha teste nenhum: a regra
 * da Spec 027 e que `components/` desenha e `lib/` decide -- e texto por tipo
 * e decisao. Veio para ca na Spec 050 (fatia B), junto com o tipo novo, para
 * que o texto da reacao nascesse com guardiao.
 *
 * ⚠️ O `emoji` vem do PAYLOAD, e nao da reacao atual: a notificacao e
 * snapshot. Se a pessoa trocar 👍 por ❤️ depois, o aviso continua dizendo o que
 * aconteceu quando foi emitido. Sem `emoji` (payload antigo ou falho), a frase
 * fica sem ele em vez de mostrar "undefined".
 */
export function textoDaNotificacao(
  n: Pick<AppNotification, "type" | "payload">,
): string {
  const ator = n.payload?.actor_name || "Alguém";
  const task = n.payload?.task_title || "uma tarefa";
  if (n.type === "TASK_ASSIGNED") return `${ator} designou você em "${task}"`;
  if (n.type === "TASK_COMMENTED") return `${ator} comentou em "${task}"`;
  if (n.type === "TASK_MENTIONED") return `${ator} mencionou você em "${task}"`;
  if (n.type === "TASK_COMMENT_REACTED") {
    const emoji = n.payload?.emoji;
    return emoji
      ? `${ator} reagiu com ${emoji} ao seu comentário em "${task}"`
      : `${ator} reagiu ao seu comentário em "${task}"`;
  }
  return `Atualização em "${task}"`;
}
