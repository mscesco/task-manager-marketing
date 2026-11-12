// Para onde uma notificação leva e o texto dela no sino. O destino é
// `/tarefa/<id>`, a rota canônica que busca por id: listas e quadros não
// mostram tarefas em que a pessoa só foi mencionada, nem subtarefas soltas.

import type { AppNotification } from "./api";
import { agoraNoWorkspace, type Agora } from "./prazo";

/** O minimo que precisamos saber de uma notificacao para achar o destino. */
export type NotificacaoNavegavel = {
  task_id: string | null;
  /** "gone" = excluida ou sem acesso -> sem destino. */
  task_access?: "ok" | "gone" | null;
  /** Menção, comentário e reação apontam o comentário: o detalhe rola até ele. */
  comment_id?: string | null;
};

/**
 * URL que o clique na notificacao deve abrir.
 *
 * Sem `task_id` (aviso de sistema, sem tarefa associada) cai em
 * `/minhas-tarefas`, que e o painel padrao de quem recebe aviso.
 */
export function destinoDaNotificacao(n: NotificacaoNavegavel): string | null {
  // Excluída ou fora do alcance: sem link (daria 404).
  if (n.task_access === "gone") return null;
  if (!n.task_id) return "/minhas-tarefas";
  if (n.comment_id) return `/tarefa/${n.task_id}?comentario=${n.comment_id}`;
  return `/tarefa/${n.task_id}`;
}

/**
 * O texto de uma notificação no sino. É um retrato do momento: o `emoji` vem
 * do payload, não da reação atual.
 */
export function textoDaNotificacao(
  n: Pick<AppNotification, "type" | "payload">,
  agora: Agora = agoraNoWorkspace(),
): string {
  const ator = n.payload?.actor_name || "Alguém";
  // Sem título (tarefa excluída ou fora do alcance), "uma tarefa" vai sem aspas.
  const titulo = n.payload?.task_title;
  const q = (s: string) => (titulo ? `"${s}"` : s);
  const task = titulo || "uma tarefa";
  if (n.type === "TASK_ASSIGNED") return `${ator} designou você em ${q(task)}`;
  if (n.type === "TASK_COMMENTED") return `${ator} comentou em ${q(task)}`;
  if (n.type === "TASK_MENTIONED") return `${ator} mencionou você em ${q(task)}`;
  if (n.type === "TASK_COMMENT_REPLIED") {
    return `${ator} respondeu ao seu comentário em ${q(task)}`;
  }
  if (n.type === "TASK_COMMENT_REACTED") {
    const emoji = n.payload?.emoji;
    return emoji
      ? `${ator} reagiu com ${emoji} ao seu comentário em ${q(task)}`
      : `${ator} reagiu ao seu comentário em ${q(task)}`;
  }
  if (n.type === "TASK_DUE_SOON") {
    const prazo = n.payload?.due_date;
    if (!prazo) return `${q(task)} vence em breve`;
    // "Hoje" no fuso do workspace; compara e corta a string, sem `new Date`
    // (que leria meia-noite UTC e escorregaria um dia).
    if (prazo === agora.data) return `${q(task)} vence hoje`;
    return `${q(task)} vence em ${prazo.slice(8, 10)}/${prazo.slice(5, 7)}`;
  }
  if (n.type === "TASK_OVERDUE") return `${q(task)} está atrasada`;
  // Só chegam quando foi outra pessoa.
  if (n.type === "TASK_WATCH_ADDED") return `${ator} colocou você para seguir ${q(task)}`;
  if (n.type === "TASK_WATCH_REMOVED") return `${ator} tirou você de ${q(task)}`;
  if (n.type === "TASK_COLUMN_CHANGED") {
    const de = n.payload?.from_column;
    const para = n.payload?.to_column;
    if (de && para) return `${ator} moveu ${q(task)} de ${de} para ${para}`;
    if (para) return `${ator} moveu ${q(task)} para ${para}`;
    return `${ator} moveu ${q(task)}`;
  }
  if (n.type === "TASK_DUE_CHANGED") {
    const novo = n.payload?.to_due;
    if (!novo) return `${ator} tirou o prazo de ${q(task)}`;
    // Corta a string, sem `new Date`.
    const dia = `${novo.date.slice(8, 10)}/${novo.date.slice(5, 7)}`;
    return `${ator} mudou o prazo de ${q(task)} para ${dia}${novo.time ? ` ${novo.time}` : ""}`;
  }
  if (n.type === "TASK_DESCRIPTION_CHANGED") return `${ator} editou a descrição de ${q(task)}`;
  if (n.type === "TASK_ARCHIVED") return `${ator} arquivou ${q(task)}`;
  if (n.type === "TASK_UNARCHIVED") return `${ator} desarquivou ${q(task)}`;
  if (n.type === "TASK_DELETED") return `${ator} excluiu ${q(task)}`;
  if (n.type === "ACCESS_LOST") {
    // "acesso": a contagem inclui tarefas em que a pessoa só seguia.
    const q = n.payload?.quantidade ?? 0;
    const tarefas = q === 1 ? "1 tarefa" : `${q} tarefas`;
    return `${ator} mudou seu time: você deixou de ter acesso a ${tarefas}`;
  }
  return `Atualização em ${q(task)}`;
}
