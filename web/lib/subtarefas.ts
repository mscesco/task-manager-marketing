/**
 * Regras da checklist de subtarefas (Spec 031, C11).
 *
 * FRONTEIRA (Spec 027): o modal desenha, isto decide.
 *
 * ⚠️ EXISTEM DUAS CONTAGENS DE FILHAS, E ELAS NAO SAO A MESMA:
 *
 *   ativas(filhos).length   -> o que a CHECKLIST mostra. Arquivada sai: a
 *                              checklist responde "o que falta fazer", e
 *                              arquivar E dizer "isto saiu do fluxo".
 *   filhos.length           -> o que a EXCLUSAO apaga. A cascata do backend
 *                              (ADR 0005) leva a subarvore INTEIRA, arquivada
 *                              ou nao.
 *
 * Este arquivo existe porque eu troquei uma pela outra: o guarda do aviso de
 * exclusao passou a usar a contagem da checklist, e uma tarefa com filhas
 * SO arquivadas deixava de mostrar qualquer aviso -- enquanto a exclusao
 * apagava as duas do mesmo jeito. Aviso destrutivo que some em silencio.
 */
import type { Task } from "@/lib/api";

/**
 * O que a checklist DESENHA.
 *
 * Com `mostrarArquivadas` a arquivada volta, mas apagada (a tela cuida do
 * visual). Ela continua FORA do `progresso` de proposito: a barra responde
 * "quanto falta do trabalho vivo", e contar o que saiu do fluxo faria a
 * porcentagem cair quando alguem arquiva -- exatamente o oposto de arquivar.
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
 */
export function progresso(filhos: Pick<Task, "status" | "is_archived">[]): {
  concluidas: number;
  total: number;
  pct: number;
} {
  const vivas = ativas(filhos);
  const concluidas = vivas.filter((f) => f.status === "COMPLETED").length;
  const total = vivas.length;
  return { concluidas, total, pct: total ? Math.round((concluidas / total) * 100) : 0 };
}
