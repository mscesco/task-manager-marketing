import { plural } from "@/lib/status";

/**
 * Regras da exclusao de tarefa (Spec 031, C5).
 *
 * FRONTEIRA (Spec 027): a tela desenha, isto decide. E uma funcao so hoje,
 * mas e a UNICA regra testavel de uma acao DESTRUTIVA -- o resto da fatia e
 * fiacao de componente, que o vitest nao enxerga (`include` limitado a
 * `lib/**`). Deixar tambem esta parte na pagina seria zerar a cobertura de
 * um caminho que apaga dado.
 */

/**
 * Texto do aviso apos excluir.
 *
 * `cascadeCount` e o numero de FILHAS apagadas junto, sem contar a raiz --
 * e o que o backend devolve (ADR 0005). Zero filhas nao vira "e 0 subtarefas":
 * afirmar "0" numa tarefa que a pessoa nem sabia ter filhos e ruido, e o
 * plural errado ("1 subtarefas") e o tipo de detalhe que faz a interface
 * parecer descuidada justamente no momento mais delicado.
 */
export function mensagemExclusao(titulo: string, cascadeCount: number): string {
  if (cascadeCount <= 0) return `"${titulo}" excluída.`;
  // Spec 031 (C9): reusa `plural` em vez de reimplementar a regra. Ela nasceu
  // do bug "1 canceladas" no contador do quadro; a regra de singular do
  // portugues mora em UM lugar so, senao o proximo contador repete o erro.
  return `"${titulo}" e ${plural(cascadeCount, "subtarefa", "subtarefas")} excluídas.`;
}
