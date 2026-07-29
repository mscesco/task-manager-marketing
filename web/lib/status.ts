// lib/status.ts
// Os 8 status do backend (enum task_status) + rotulo PT e cor da coluna.
// Decisao da Camila (E9): mostrar todos no Kanban. Se um dia quiser
// colapsar, e so reduzir esta lista / mapear aqui -- a tela le daqui.
// Spec 026: EXTERNAL_APPROVAL (aprovacao de fora do time) entra entre a
// aprovacao interna e o concluido; IN_REVIEW passou a "Aprovacao Interna"
// para o par de rotulos nao ficar ambiguo ("Em Aprovacao" x "Externa").
export const STATUSES = [
  { key: "BACKLOG", label: "Backlog", color: "#64748b" },
  { key: "PLANNED", label: "Planejado", color: "#6366f1" },
  { key: "IN_PROGRESS", label: "Em Andamento", color: "#0ea5e9" },
  { key: "IN_REVIEW", label: "Aprovação Interna", color: "#f59e0b" },
  { key: "EXTERNAL_APPROVAL", label: "Aprovação Externa", color: "#8b5cf6" },
  { key: "COMPLETED", label: "Concluído", color: "#22c55e" },
  { key: "CANCELLED", label: "Cancelado", color: "#94a3b8" },
  { key: "BLOCKED", label: "Bloqueado", color: "#ef4444" },
] as const;

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};
export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "#64748b",
  MEDIUM: "#0ea5e9",
  HIGH: "#f59e0b",
  URGENT: "#ef4444",
};

// Status que "Minhas tarefas" mostra ao ABRIR (pedido da Camila, 29/07).
//
// COMPLETED fica de fora: a tela responde "o que eu tenho pra fazer", e o que
// ja foi feito nao e resposta pra isso. Antes, toda visita comecava com a
// pessoa desmarcando "Concluido" na mao.
//
// CANCELLED continua LIGADO de proposito, mesmo sendo terminal: cancelamento
// costuma ser noticia ("por que isso foi cancelado?"), enquanto conclusao e
// rotina. Se incomodar, e so incluir "CANCELLED" no Set abaixo.
//
// O filtro segue manual: "Todos" traz tudo de volta em um clique.
const STATUS_OCULTOS_POR_PADRAO = new Set<string>(["COMPLETED"]);

export function statusPadraoMinhasTarefas(): string[] {
  return STATUSES.map((s) => s.key).filter(
    (k) => !STATUS_OCULTOS_POR_PADRAO.has(k)
  );
}

// Cor de prazo (Spec 023): laranja perto de vencer, vermelho atrasado.
// null = sem alerta (sem prazo, arquivada, ou status terminal).
export type DeadlineTone = "overdue" | "soon" | null;

export const DEADLINE_COLOR: Record<"overdue" | "soon", string> = {
  overdue: "#dc2626", // vermelho (atrasada)
  soon: "#f59e0b", // laranja/ambar (vence em <=2 dias)
};

// Compara em DATA local (meia-noite), nao em instante -- o prazo e um dia, nao
// uma hora. Assume o fuso do browser (equipe no Brasil -> BRT, casa com o
// backend que usa America/Sao_Paulo). Concluida/cancelada/arquivada -> null.
function deadlineDays(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00"); // meia-noite local
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.round((due.getTime() - hoje.getTime()) / 86400000);
}

export function deadlineTone(
  dueDate: string | null | undefined,
  status: string,
  isArchived: boolean
): DeadlineTone {
  if (!dueDate || isArchived) return null;
  // Concluida/cancelada/bloqueada -> sem alerta (nao ha o que agir no prazo).
  if (status === "COMPLETED" || status === "CANCELLED" || status === "BLOCKED") {
    return null;
  }
  const dias = deadlineDays(dueDate);
  if (dias < 0) return "overdue";
  if (dias <= 2) return "soon";
  return null;
}

// Rotulo relativo do prazo (ex.: "Atrasada 2 dias", "Vence hoje", "Vence em 2
// dias"). So chamar quando deadlineTone != null.
export function deadlineLabel(dueDate: string): string {
  const dias = deadlineDays(dueDate);
  if (dias < 0) return dias === -1 ? "Atrasada 1 dia" : `Atrasada ${-dias} dias`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`;
}
