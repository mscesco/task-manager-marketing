// Ordenação de lista de tarefas (criação / prazo / prioridade), usada pelo
// quadro e por "Minhas tarefas". Empate sempre cai em created_at desc, para a
// coluna não "tremer" a cada recarga.

import type { Task } from "@/lib/api";

export type Ordenacao = "criacao" | "prazo" | "prioridade";

export const ORDENACOES: { key: Ordenacao; label: string }[] = [
  { key: "criacao", label: "Ordenar: criação" },
  { key: "prazo", label: "Ordenar: prazo" },
  { key: "prioridade", label: "Ordenar: prioridade" },
];

const PRIO_RANK: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

type Ordenavel = Pick<Task, "created_at" | "due_date" | "priority">;

const porData = (a: Ordenavel, b: Ordenavel) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

export function comparador(
  ordenacao: Ordenacao
): (a: Ordenavel, b: Ordenavel) => number {
  if (ordenacao === "prazo") {
    return (a, b) => {
      // Sem prazo vai para o fim; entre os com prazo, o mais próximo primeiro.
      const da = a.due_date ?? "";
      const db = b.due_date ?? "";
      if (!da && !db) return porData(a, b);
      if (!da) return 1;
      if (!db) return -1;
      if (da !== db) return da < db ? -1 : 1;
      return porData(a, b);
    };
  }
  if (ordenacao === "prioridade") {
    return (a, b) => {
      const pa = PRIO_RANK[a.priority] ?? 0;
      const pb = PRIO_RANK[b.priority] ?? 0;
      if (pa !== pb) return pb - pa; // Urgente primeiro.
      return porData(a, b);
    };
  }
  return porData;
}

/** Copia ordenada -- NAO mexe no array recebido (ele costuma ser estado). */
export function ordenar<T extends Ordenavel>(itens: T[], ordenacao: Ordenacao): T[] {
  return [...itens].sort(comparador(ordenacao));
}
