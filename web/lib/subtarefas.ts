/**
 * Regras da checklist de subtarefas. Há duas contagens de filhas: a checklist
 * (sem arquivadas) e a exclusão (`filhos.length`: a cascata apaga a subárvore
 * inteira, arquivada ou não). Não troque uma pela outra no aviso de exclusão.
 */
import type { Task } from "@/lib/api";
import { terminal, type Coluna } from "@/lib/coluna";

/**
 * O que a checklist desenha. Com `mostrarArquivadas` a arquivada volta
 * (apagada), mas continua fora do `progresso`.
 */
export function paraChecklist<T extends { is_archived: boolean }>(
  filhos: T[],
  mostrarArquivadas: boolean
): T[] {
  return mostrarArquivadas ? filhos : ativas(filhos);
}

/** Filhas que a checklist mostra quando as arquivadas estao escondidas. */
export function ativas<T extends { is_archived: boolean }>(filhos: T[]): T[] {
  return filhos.filter((f) => !f.is_archived);
}

/**
 * Progresso da checklist. `pct` e inteiro 0..100, e vale 0 (nao NaN) quando
 * nao ha filha ativa -- 0/0 alimentaria a largura da barra com "NaN%".
 *
 * Decide pela coluna, como o contador do card. Só `DONE` conta (cancelada
 * não). Coluna desconhecida conta como trabalho vivo, no denominador.
 */
export function progresso(
  filhos: Pick<Task, "column_id" | "is_archived">[],
  colunaPorId: Map<string, Coluna>
): {
  concluidas: number;
  total: number;
  pct: number;
} {
  const vivas = ativas(filhos);
  const concluidas = vivas.filter(
    (f) => colunaPorId.get(f.column_id)?.semantic === "DONE"
  ).length;
  const total = vivas.length;
  return { concluidas, total, pct: total ? Math.round((concluidas / total) * 100) : 0 };
}

/**
 * O que a checklist desenha (`linhas`) e o que ela conta, de uma chamada só.
 * Não use `linhas.length` como denominador: com arquivadas à vista ele as
 * inclui, e `total` é sempre trabalho vivo. Filhas só arquivadas dão
 * `total: 0`, e a tela não desenha contador nem barra.
 */
export function checklist<
  T extends Pick<Task, "column_id" | "is_archived" | "due_date" | "due_time">,
>(
  filhos: T[],
  mostrarArquivadas: boolean,
  colunaPorId: Map<string, Coluna>
): { linhas: T[]; concluidas: number; total: number; pct: number } {
  return {
    linhas: ordemDaChecklist(paraChecklist(filhos, mostrarArquivadas), colunaPorId),
    ...progresso(filhos, colunaPorId),
  };
}

/**
 * Ordem da checklist: por prazo (dia, depois hora; sem hora fecha o dia), sem
 * prazo depois, e concluída ou cancelada por último. Empate mantém a ordem do servidor.
 */
export function ordemDaChecklist<
  T extends Pick<Task, "column_id" | "due_date" | "due_time">,
>(filhos: T[], colunaPorId: Map<string, Coluna>): T[] {
  const chave = (f: T) => {
    const col = colunaPorId.get(f.column_id);
    return [
      col && terminal(col) ? 1 : 0,
      f.due_date ? 0 : 1,
      f.due_date ?? "",
      f.due_time ?? "99",
    ] as const;
  };
  return [...filhos].sort((a, b) => {
    const ka = chave(a);
    const kb = chave(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}
