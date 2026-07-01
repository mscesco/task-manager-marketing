// lib/status.ts
// Os 7 status do backend (enum task_status) + rotulo PT e cor da coluna.
// Decisao da Camila (E9): mostrar os 7 no Kanban. Se um dia quiser
// colapsar 7->4, e so reduzir esta lista / mapear aqui -- a tela le daqui.
export const STATUSES = [
  { key: "BACKLOG", label: "Backlog", color: "#64748b" },
  { key: "PLANNED", label: "Planejado", color: "#6366f1" },
  { key: "IN_PROGRESS", label: "Em Andamento", color: "#0ea5e9" },
  { key: "IN_REVIEW", label: "Em Aprovação", color: "#f59e0b" },
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
