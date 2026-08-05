/**
 * Spec 033 -- valores iniciais do modal ao DUPLICAR uma tarefa.
 *
 * Fronteira da Spec 027: isto DECIDE, entao mora em `lib/`. O modal desenha.
 *
 * As tres regras que este arquivo defende, e por que cada uma existe:
 *
 *   D5 -- datas SEMPRE vazias. Nao e preferencia: e o job de prazo. Cópia de
 *         uma campanha de março nasce vencida, e como as colunas de dedup nao
 *         sao copiadas, a próxima execução do job dispara TASK_OVERDUE para
 *         todas de uma vez. Em 01/08 foram 51 numa execução só.
 *   D8 -- prefixo "Cópia de", TRUNCADO ao limite do campo. Título já no
 *         limite + 9 caracteres = 422 numa operação que a pessoa acha que é
 *         um clique.
 *   D9 -- só entra no pré-preenchimento do pai quem está na lista de
 *         PERMITIDOS. Qualquer outro daria 422 no salvar, nomeando alguém que
 *         quem clicou talvez nem conheça.
 */

export const PREFIXO_COPIA = "Cópia de ";

/** Mesmo `maxLength` do campo de título no TaskModal e no schema da API. */
export const LIMITE_TITULO = 255;

export type TarefaParaCopiar = {
  title: string;
  description: string;
  priority: string;
  assignee_ids?: string[];
};

export type FilhaParaCopiar = {
  is_archived: boolean;
};

export type ValoresDaCopia = {
  title: string;
  description: string;
  priority: string;
  assigneeIds: string[];
  /** Sempre "" -- ver D5. O tipo é string para casar com <input type="date">. */
  startDate: string;
  dueDate: string;
  /** Filhas DIRETAS não arquivadas. Alimenta o rótulo da caixa (D7). */
  subtarefasVivas: number;
};

/**
 * Título da cópia (D8).
 *
 * ⚠️ Trunca o TÍTULO, não o resultado: cortar o resultado inteiro poderia
 * comer o próprio prefixo em um título já no limite, e a cópia sairia
 * chamada "Cópia d". Aqui o prefixo é sempre preservado por inteiro.
 *
 * ⚠️ Sem reticências. O campo é editável e a pessoa vai renomear; três
 * caracteres de enfeite só roubam espaço do que sobrou do título.
 */
export function tituloDaCopia(titulo: string): string {
  const sobra = LIMITE_TITULO - PREFIXO_COPIA.length;
  return PREFIXO_COPIA + titulo.slice(0, Math.max(0, sobra));
}

/**
 * Monta os valores iniciais do modal em modo cópia.
 *
 * `permitidos` = quem PODE ser responsável desta cópia: membros ativos que
 * alcançam a tarefa. Regra POSITIVA, e a escolha é deliberada.
 *
 * ⚠️ A primeira versão recebia `excluidos` (quem NÃO pode) e furou em
 * produção em 04/08: o modal já filtra `is_active` ao carregar a lista de
 * membros, então quem foi DESATIVADO depois da tarefa original nunca aparecia
 * na lista -- e por isso não entrava em nenhum conjunto de exclusão. Ele
 * sobrevivia ao pré-preenchimento e o salvar devolvia 422. Uma lista de
 * "quem não pode" só sabe excluir quem ela conhece; a de "quem pode" fecha o
 * caso inteiro.
 *
 * O conjunto vem pronto de quem já calculou alcance para os próprios
 * seletores -- não reconstruir a regra aqui foi o ganho da Spec 034.
 *
 * `filhas` são as filhas DIRETAS. O front não conhece neto; por isso o rótulo
 * da caixa diz "N diretas" (D4) -- havendo neto, chegam mais tarefas do que o
 * número mostrado, e a palavra "diretas" é o que impede a pessoa de achar que
 * o sistema inventou tarefas.
 */
export function valoresIniciaisDaCopia(
  origem: TarefaParaCopiar,
  permitidos: Set<string>,
  filhas: FilhaParaCopiar[],
): ValoresDaCopia {
  return {
    title: tituloDaCopia(origem.title),
    description: origem.description,
    priority: origem.priority,
    assigneeIds: (origem.assignee_ids ?? []).filter((id) => permitidos.has(id)),
    // D5. Não são "campos que esqueci de preencher" -- são a decisão.
    startDate: "",
    dueDate: "",
    // D10: arquivada não é copiada, então não pode ser contada. A pessoa que
    // vê 6 e recebe 4 acha que perdeu duas.
    subtarefasVivas: filhas.filter((f) => !f.is_archived).length,
  };
}

/**
 * Aviso da D14 quando a pessoa DESMARCA "levar os responsáveis das
 * subtarefas". `null` = nada a avisar.
 *
 * ⚠️ Este aviso é a única proteção que sobrou. A regra de 29/07 (responsável
 * obrigatório) nasceu porque 44 das 50 tarefas ativas sem responsável eram
 * subtarefas; a caixa desmarcada recria esse passivo de N em N, num clique.
 * A porta foi aberta de propósito (D14, opção 2) -- com aviso. Tirar o aviso
 * sem tirar a caixa desfaz a decisão.
 */
export function avisoSemResponsaveis(
  levarSubtarefas: boolean,
  levarResponsaveis: boolean,
  subtarefasVivas: number,
): string | null {
  if (!levarSubtarefas || levarResponsaveis || subtarefasVivas === 0) {
    return null;
  }
  return subtarefasVivas === 1
    ? "A subtarefa copiada nascerá sem responsável."
    : `As ${subtarefasVivas} subtarefas copiadas nascerão sem responsável.`;
}

/** Rótulo da caixa da D7. `null` quando não há filha viva (critério 16). */
export function rotuloCaixaSubtarefas(subtarefasVivas: number): string | null {
  if (subtarefasVivas === 0) return null;
  // ⚠️ A palavra "diretas" é OBRIGATÓRIA (D4). Ver docstring de
  // valoresIniciaisDaCopia.
  return `Levar as subtarefas (${subtarefasVivas} diretas)`;
}
