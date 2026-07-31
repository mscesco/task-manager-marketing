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

/**
 * O que a checklist DESENHA e o que ela CONTA, de uma chamada so.
 *
 * ⚠️ Existe porque separar as duas coisas em duas chamadas ja produziu o bug:
 * a tela pegava `concluidas` de `progresso` (que ignora arquivada) e usava
 * `paraChecklist(...).length` como denominador (que INCLUI arquivada quando a
 * caixa esta marcada). O rotulo dizia "(1/3)" com a barra em 50%, e em
 * `/arquivadas` -- onde `mostrarArquivadas` e fixo -- uma tarefa de filhas so
 * arquivadas e concluidas mostrava "(0/2)" com a barra vazia e as duas caixas
 * marcadas logo abaixo.
 *
 *   linhas  -> as LINHAS a desenhar (arquivada entra quando a caixa esta
 *              marcada; a tela so a apaga visualmente).
 *   total   -> o denominador do "(x/y)" e da barra. SEMPRE trabalho vivo:
 *              `concluidas`, `total` e `pct` vem do mesmo `progresso`, entao
 *              numerador e denominador nao tem como divergir de novo.
 *
 * Consequencia deliberada: filhas SO arquivadas dao `total: 0` com
 * `linhas.length: 2`. A tela desenha as duas linhas e NAO desenha contador
 * nem barra -- nao ha trabalho vivo sobre o que informar progresso.
 */
export function checklist<T extends Pick<Task, "status" | "is_archived">>(
  filhos: T[],
  mostrarArquivadas: boolean
): { linhas: T[]; concluidas: number; total: number; pct: number } {
  return {
    linhas: paraChecklist(filhos, mostrarArquivadas),
    ...progresso(filhos),
  };
}
