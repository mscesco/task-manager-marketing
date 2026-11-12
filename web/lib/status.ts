// Os 8 status do backend (enum task_status), rótulo e cor; a tela lê daqui.
//
// As cores são tokens `var(--x)` declarados nos dois temas em app/globals.css:
// `--*-dot` para o que não é texto (bolinha, borda) e `--*-text` para texto
// sobre --surface e fundo sob --on-chroma. Não concatene string em cima deles
// (`var(--x)1a` é declaração inválida).
import type { ProjectStatus } from "@/lib/api";
import { agoraNoWorkspace, estaAtrasada } from "@/lib/prazo";

// Status de PROJETO (difere do status de tarefa abaixo).
export const PROJECT_STATUS: { key: ProjectStatus; label: string; color: string }[] = [
  { key: "PLANNING", label: "Planejamento", color: "var(--status-backlog-text)" },
  { key: "ACTIVE", label: "Ativo", color: "var(--teal)" },
  { key: "BLOCKED", label: "Bloqueado", color: "var(--status-blocked-text)" },
  { key: "COMPLETED", label: "Concluído", color: "var(--status-progress-text)" },
  { key: "CANCELLED", label: "Cancelado", color: "var(--status-cancel-text)" },
];
export const PROJECT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.label])
);
export const PROJECT_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.color])
);

export const STATUSES = [
  { key: "BACKLOG", label: "Backlog", color: "var(--status-backlog-dot)" },
  { key: "PLANNED", label: "Planejado", color: "var(--status-planned-dot)" },
  { key: "IN_PROGRESS", label: "Em Andamento", color: "var(--status-progress-dot)" },
  { key: "IN_REVIEW", label: "Aprovação Interna", color: "var(--status-review-dot)" },
  // Os tokens `--status-external-*` / `--status-done-*` apontam para estas
  // mesmas cores, porque a cor de coluna gravada no banco usa esses nomes.
  { key: "EXTERNAL_APPROVAL", label: "Aprovação Externa", color: "var(--violet)" },
  { key: "COMPLETED", label: "Concluído", color: "var(--teal)" },
  { key: "CANCELLED", label: "Cancelado", color: "var(--status-cancel-dot)" },
  { key: "BLOCKED", label: "Bloqueado", color: "var(--status-blocked-dot)" },
] as const;

// Cor de texto do status, e também de fundo sob --on-chroma (Badge solid/outline).
export const STATUS_TEXT: Record<string, string> = {
  BACKLOG: "var(--status-backlog-text)",
  PLANNED: "var(--status-planned-text)",
  IN_PROGRESS: "var(--status-progress-text)",
  IN_REVIEW: "var(--status-review-text)",
  EXTERNAL_APPROVAL: "var(--violet)",
  COMPLETED: "var(--teal)",
  CANCELLED: "var(--status-cancel-text)",
  BLOCKED: "var(--status-blocked-text)",
};

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

// Tokens de texto. Urgente e Média não usam `--danger`/`--accent` porque
// reprovam contraste AA no tema claro.
export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "var(--prio-low-text)",
  MEDIUM: "var(--prio-medium-text)",
  HIGH: "var(--amber)",
  URGENT: "var(--prio-urgent-text)",
};

// Cor de prazo: laranja perto de vencer, vermelho atrasado.
// null = sem alerta (sem prazo, arquivada, ou status terminal).
export type DeadlineTone = "overdue" | "soon" | null;

export const DEADLINE_COLOR: Record<"overdue" | "soon", string> = {
  overdue: "var(--due-overdue-text)",
  soon: "var(--amber)",
};

// ===========================================================================
// Selo "parada há X dias" e prazo por STATUS. Código novo usa as versões por
// coluna de `lib/coluna.ts`; `paridadeColuna.test.ts` compara as duas.
// ===========================================================================
//
// Mede o tempo desde o último `updated_at`, que não muda com comentário nem
// com designação: uma tarefa discutida nos comentários aparece como parada.
export const DIAS_PARA_PARADA = 7;

/** Rotulo do selo. So chamar quando `diasParadoPorColuna` != null. */
export function paradaLabel(dias: number): string {
  return `Parada há ${dias} d`;
}

// Dias até o prazo, comparando datas no fuso do workspace (não no da máquina,
// senão o CI em UTC discorda entre 00h e 03h).
export function deadlineDays(dueDate: string): number {
  // Os dois lados em `T00:00:00Z`: datas puras, subtração em dias inteiros.
  const due = Date.parse(dueDate + "T00:00:00Z");
  const hoje = Date.parse(agoraNoWorkspace().data + "T00:00:00Z");
  return Math.round((due - hoje) / 86400000);
}

export function deadlineTone(
  dueDate: string | null | undefined,
  status: string,
  isArchived: boolean,
  /** Ausente = sem hora. */
  dueTime?: string | null
): DeadlineTone {
  if (!dueDate || isArchived) return null;
  // Concluida/cancelada/bloqueada -> sem alerta (nao ha o que agir no prazo).
  if (status === "COMPLETED" || status === "CANCELLED" || status === "BLOCKED") {
    return null;
  }
  // "Atrasou?" vem sempre de `estaAtrasada`, como em `deadlineTonePorColuna`.
  if (estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) return "overdue";
  const dias = deadlineDays(dueDate);
  if (dias <= 2) return "soon";
  return null;
}

// Data absoluta do prazo, com a hora quando existe: "19/08/2026 18:00".
// O backend devolve `HH:MM:SS`, daí o `slice(0, 5)`.
export function dataHoraBR(
  dueDate: string,
  dueTime?: string | null
): string {
  // `T00:00:00` sem sufixo de fuso = meia-noite LOCAL. Sem ele, `new Date`
  // trata `YYYY-MM-DD` como UTC e o dia anda para tras a oeste de Greenwich.
  const dia = new Date(dueDate + "T00:00:00").toLocaleDateString("pt-BR");
  return dueTime ? `${dia} ${dueTime.slice(0, 5)}` : dia;
}

// Rótulo relativo do prazo ("Atrasada 2 dias", "Vence hoje"). Só chamar quando
// deadlineTone != null. Usa a hora pela mesma regra do tom, para cor e texto
// não discordarem.
export function deadlineLabel(
  dueDate: string,
  dueTime?: string | null
): string {
  const dias = deadlineDays(dueDate);
  if (dias < 0) return dias === -1 ? "Atrasada 1 dia" : `Atrasada ${-dias} dias`;
  const hhmm = dueTime ? dueTime.slice(0, 5) : null;
  if (dias === 0) {
    // Com hora, "hoje" pode já ter passado.
    if (hhmm && estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) {
      return `Venceu às ${hhmm}`;
    }
    return hhmm ? `Vence hoje às ${hhmm}` : "Vence hoje";
  }
  if (dias === 1) return hhmm ? `Vence amanhã às ${hhmm}` : "Vence amanhã";
  return `Vence em ${dias} dias`;
}
