// O plano de soltar um card numa coluna: a lista otimista e o que desfaz se o servidor recusar.
// Puro: quem arrasta (Board, /minhas-tarefas) faz a chamada, o aviso e o confete.

import type { Task } from "@/lib/api";
import { terminal, type Coluna } from "@/lib/coluna";

type DragTask = Pick<
  Task,
  "id" | "path" | "column_id" | "status" | "is_archived" | "subtask_done" | "subtask_total"
>;

export interface DropPlan {
  taskId: string;
  from: string;
  to: string;
  /** Destino `DONE`: as subtarefas carregadas vão junto. */
  completing: boolean;
  /** Virou concluída agora (a origem não era `DONE`): é a vez do confete. */
  celebrate: boolean;
  /** Coluna e status de antes de cada subtarefa que a cascata mexe. */
  cascaded: Map<string, { column: string; status: string }>;
  /** `subtask_done` da mãe antes de soltar; `null` = a tela não mexe no contador. */
  parentDone: { before: number | undefined } | null;
}

export interface DropOptions<T> {
  /** As colunas desta tela: soltar fora delas (outro quadro) daria 422 depois de mexer na tela. */
  columns: readonly Coluna[];
  /** A coluna real de qualquer tarefa carregada (a subtarefa pode estar em outro quadro). */
  columnOf: (columnId: string) => Coluna | undefined;
  /** Recusa antes de mexer (ex.: card de outro quadro). */
  canMove?: (task: T) => boolean;
  /** Sem as filhas no lote, o contador `☑ x/y` da mãe muda aqui. */
  countSubtasks?: boolean;
}

/** `null` = nada a fazer (sem destino, mesma coluna, ou recusado). */
export function planDrop<T extends DragTask>(
  tasks: readonly T[],
  taskId: string,
  to: string | null,
  { columns, columnOf, canMove, countSubtasks = false }: DropOptions<T>
): DropPlan | null {
  if (!to) return null;
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.column_id === to) return null;
  if (canMove && !canMove(task)) return null;
  const target = columns.find((c) => c.id === to);
  if (!target) return null;

  const completing = target.semantic === "DONE";
  // `"COMPLETED"` é seguro só aqui: a cascata do backend grava esse valor fixo.
  const cascaded = new Map<string, { column: string; status: string }>();
  if (completing) {
    const prefix = task.path + ".";
    for (const t of tasks) {
      const col = columnOf(t.column_id);
      if (t.path.startsWith(prefix) && col && !terminal(col) && !t.is_archived) {
        cascaded.set(t.id, { column: t.column_id, status: t.status });
      }
    }
  }
  return {
    taskId,
    from: task.column_id,
    to,
    completing,
    celebrate: completing && columnOf(task.column_id)?.semantic !== "DONE",
    cascaded,
    parentDone: countSubtasks ? { before: task.subtask_done } : null,
  };
}

/** A lista otimista: a mãe no destino e a cascata concluída. */
export function applyDrop<T extends DragTask>(tasks: readonly T[], plan: DropPlan): T[] {
  return tasks.map((t) => {
    if (t.id === plan.taskId)
      return plan.parentDone
        ? {
            ...t,
            column_id: plan.to,
            subtask_done: plan.completing ? t.subtask_total : t.subtask_done,
          }
        : { ...t, column_id: plan.to };
    if (plan.cascaded.has(t.id)) return { ...t, column_id: plan.to, status: "COMPLETED" };
    return t;
  });
}

/** Desfaz o otimista inteiro: coluna da mãe, contador, e coluna e status de cada subtarefa. */
export function revertDrop<T extends DragTask>(tasks: readonly T[], plan: DropPlan): T[] {
  return tasks.map((t) => {
    if (t.id === plan.taskId)
      return plan.parentDone
        ? { ...t, column_id: plan.from, subtask_done: plan.parentDone.before }
        : { ...t, column_id: plan.from };
    const before = plan.cascaded.get(t.id);
    return before ? { ...t, column_id: before.column, status: before.status } : t;
  });
}
