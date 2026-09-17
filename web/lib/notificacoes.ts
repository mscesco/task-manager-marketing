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
// nao e responsavel, e o criador recebe aviso de comentario sem estar
// designado. Nesses casos a tarefa nao esta na lista de atribuicoes, a
// pagina nao acha nada e o clique nao abre coisa alguma.
//
// ⚠️ ESTE PARAGRAFO DIZIA QUE "watcher recebe aviso de comentario". Nao
// recebia (Spec 053, §2.3) -- passa a receber na fatia C da 053.
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
import { agoraNoWorkspace, type Agora } from "./prazo";

/** O minimo que precisamos saber de uma notificacao para achar o destino. */
export type NotificacaoNavegavel = {
  task_id: string | null;
  /** Spec 053 (E): "gone" = excluida ou sem acesso -> sem destino. */
  task_access?: "ok" | "gone" | null;
};

/**
 * URL que o clique na notificacao deve abrir.
 *
 * Sem `task_id` (aviso de sistema, sem tarefa associada) cai em
 * `/minhas-tarefas`, que e o painel padrao de quem recebe aviso.
 */
export function destinoDaNotificacao(n: NotificacaoNavegavel): string | null {
  // ⚠️ Spec 053 (D27): tarefa excluida ou fora do alcance NAO tem destino --
  // o link levaria a um 404. A tela desenha o aviso apagado e sem link.
  if (n.task_access === "gone") return null;
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
  agora: Agora = agoraNoWorkspace(),
): string {
  const ator = n.payload?.actor_name || "Alguém";
  // ⚠️ Spec 053 (D27): sem titulo (o servidor o tira quando a tarefa foi
  // excluida ou saiu do alcance), a frase diz "uma tarefa" SEM aspas. Com as
  // aspas ficava `moveu "uma tarefa"`, como se esse fosse o nome dela.
  const titulo = n.payload?.task_title;
  const q = (s: string) => (titulo ? `"${s}"` : s);
  const task = titulo || "uma tarefa";
  if (n.type === "TASK_ASSIGNED") return `${ator} designou você em ${q(task)}`;
  if (n.type === "TASK_COMMENTED") return `${ator} comentou em ${q(task)}`;
  if (n.type === "TASK_MENTIONED") return `${ator} mencionou você em ${q(task)}`;
  if (n.type === "TASK_COMMENT_REACTED") {
    const emoji = n.payload?.emoji;
    return emoji
      ? `${ator} reagiu com ${emoji} ao seu comentário em ${q(task)}`
      : `${ator} reagiu ao seu comentário em ${q(task)}`;
  }
  // ⚠️ Spec 053 (A): os tres tipos abaixo o backend emitia havia semanas e
  // caiam na frase generica do fim.
  if (n.type === "TASK_DUE_SOON") {
    const prazo = n.payload?.due_date;
    if (!prazo) return `${q(task)} vence em breve`;
    // ⚠️ "Hoje" e o do FUSO DO WORKSPACE (`lib/prazo.ts`), e a data vem como
    // YYYY-MM-DD: comparar e cortar a string, sem `new Date` -- que leria
    // meia-noite UTC e escorregaria um dia.
    if (prazo === agora.data) return `${q(task)} vence hoje`;
    return `${q(task)} vence em ${prazo.slice(8, 10)}/${prazo.slice(5, 7)}`;
  }
  if (n.type === "TASK_OVERDUE") return `${q(task)} está atrasada`;
  // Spec 053 (B, D17): só chegam quando foi OUTRA pessoa -- quem segue sozinho
  // não se avisa.
  if (n.type === "TASK_WATCH_ADDED") return `${ator} colocou você para seguir ${q(task)}`;
  if (n.type === "TASK_WATCH_REMOVED") return `${ator} tirou você de ${q(task)}`;
  // Spec 053 (C): o que acontece na tarefa.
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
    // ⚠️ Corta a string YYYY-MM-DD, sem `new Date` (que leria meia-noite UTC e
    // escorregaria um dia) -- mesma regra do `lib/prazo.ts`.
    const dia = `${novo.date.slice(8, 10)}/${novo.date.slice(5, 7)}`;
    return `${ator} mudou o prazo de ${q(task)} para ${dia}${novo.time ? ` ${novo.time}` : ""}`;
  }
  if (n.type === "TASK_DESCRIPTION_CHANGED") return `${ator} editou a descrição de ${q(task)}`;
  if (n.type === "TASK_ARCHIVED") return `${ator} arquivou ${q(task)}`;
  if (n.type === "TASK_UNARCHIVED") return `${ator} desarquivou ${q(task)}`;
  if (n.type === "TASK_DELETED") return `${ator} excluiu ${q(task)}`;
  if (n.type === "ACCESS_LOST") {
    // "acesso", e nao "deixou de ser responsavel": a contagem inclui tarefas
    // em que a pessoa so observava (Spec 053 §5).
    const q = n.payload?.quantidade ?? 0;
    const tarefas = q === 1 ? "1 tarefa" : `${q} tarefas`;
    return `${ator} mudou seu time: você deixou de ter acesso a ${tarefas}`;
  }
  return `Atualização em ${q(task)}`;
}
