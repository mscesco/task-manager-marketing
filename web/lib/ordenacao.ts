// Ordenacao de lista de tarefas (criacao / prazo / prioridade).
//
// Vivia dentro do `Board.tsx`. Saiu pra ca quando "Minhas tarefas" pediu o
// MESMO seletor: duas copias do comparador dariam duas ordens diferentes com
// o mesmo rotulo na tela -- o tipo de divergencia que ninguem percebe olhando
// uma tela de cada vez.
//
// Empate SEMPRE cai em created_at desc (mais nova primeiro). Sem esse
// desempate a ordem de itens equivalentes fica por conta do `sort` do
// browser sobre a ordem de chegada da API, e a coluna "treme" a cada
// recarga sem nada ter mudado.

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
      // Sem prazo vai pro FIM (nao pro topo, que e onde string vazia cairia
      // numa comparacao ingenua). Entre os com prazo, vencimento mais
      // proximo primeiro.
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
