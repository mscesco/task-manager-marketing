/**
 * Filtros do quadro por equipe (pedido da gestao, 2026-07-27).
 *
 * FRONTEIRA (Spec 027): isto e DECISAO -> mora em `lib/`, puro, sem React.
 * O `Board` ja passa de 800 linhas; enfiar mais dois predicados no meio dele
 * e como nasceu o bug do modal.
 *
 * Sao DOIS filtros independentes, que a mesma tela combina:
 *
 *   1. ESCOPO      -- interna x compartilhada com o quadro geral.
 *   2. RESPONSAVEL -- "o que a fulana esta fazendo", visao pedida pela gestao.
 *
 * Ambos herdam a regra de AGREGACAO POR RAIZ que o filtro de subtime ja usa:
 * o card do quadro e sempre a raiz (ADR 0004), entao uma raiz passa se ELA ou
 * QUALQUER subtarefa dela satisfaz o criterio. Sem isso, filtrar pela pessoa
 * que so aparece numa subtarefa faria o card inteiro sumir -- exatamente o
 * problema que o comentario do `subtimesPorRaiz` registra no Board.
 */

/** Tarefa, no minimo que estes filtros precisam. */
export type TaskMin = {
  id: string;
  parent_task_id: string | null;
  team_id: string | null;
  assignee_ids?: string[];
};

// ====================================================================
// 1. ESCOPO -- interna x compartilhada
// ====================================================================

export type FiltroEscopo = "todos" | "interna" | "compartilhada";

export type Escopo = "interna" | "compartilhada";

/**
 * Classifica a tarefa no quadro de SUBTIME.
 *
 * O quadro de subtime e hibrido: mostra a uniao de (A) tarefas da raiz cujo
 * algum responsavel pertence ao subtime -- as "compartilhadas" -- e (B)
 * tarefas que nasceram no subtime (`team_id === subteamId`).
 *
 * `undefined` fora do modo subtime (quadro geral e de projeto nao tem a
 * distincao, entao nao mostram pill nem filtro).
 */
export function escopoDaTask(
  task: Pick<TaskMin, "team_id">,
  subteamId: string | null | undefined,
): Escopo | undefined {
  if (!subteamId) return undefined;
  return task.team_id === subteamId ? "interna" : "compartilhada";
}

/** O escopo passa no filtro escolhido? `todos` sempre passa. */
export function passaEscopo(
  filtro: FiltroEscopo,
  escopo: Escopo | undefined,
): boolean {
  if (filtro === "todos") return true;
  // Fora do modo subtime nao ha escopo definido: um filtro especifico nao
  // pode esconder tudo, entao trata como "nao se aplica" e deixa passar.
  if (escopo === undefined) return true;
  return escopo === filtro;
}

// ====================================================================
// 2. RESPONSAVEL -- "o que a fulana esta fazendo"
// ====================================================================

/**
 * Sobe da tarefa ate a raiz VISIVEL no conjunto carregado.
 *
 * Se o pai nao esta no conjunto, para no topo que da -- mesma decisao do
 * `subtimesPorRaiz`. Guarda anti-ciclo por id visitado.
 */
function raizDe(task: TaskMin, byId: Map<string, TaskMin>): string {
  let atual = task;
  const vistos = new Set<string>();
  while (atual.parent_task_id && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    const pai = byId.get(atual.parent_task_id);
    if (!pai) break;
    atual = pai;
  }
  return atual.id;
}

/**
 * Agrega, por raiz, TODOS os responsaveis da subarvore.
 *
 * `id_da_raiz -> Set<user_id>`. Espelha `subtimesPorRaiz` do Board, trocando
 * "subtime do responsavel" por "o proprio responsavel".
 *
 * Motivo de existir: a gestao filtra pela pessoa e espera ver a demanda em
 * que ela trabalha, mesmo que a designacao esteja numa subtarefa -- que e o
 * caso comum (a raiz e a campanha; a pessoa toca uma peca dela).
 */
export function responsaveisPorRaiz(
  tasks: TaskMin[],
): Map<string, Set<string>> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, Set<string>>();
  for (const t of tasks) {
    const ids = t.assignee_ids ?? [];
    if (ids.length === 0) continue;
    const raizId = raizDe(t, byId);
    let set = out.get(raizId);
    if (!set) {
      set = new Set<string>();
      out.set(raizId, set);
    }
    for (const id of ids) set.add(id);
  }
  return out;
}

/**
 * A raiz passa no filtro por pessoa?
 *
 * `pessoaId` vazio = sem filtro. Raiz cuja subarvore inteira nao tem NENHUM
 * responsavel some quando ha filtro -- mesma decisao ja tomada para o filtro
 * de subtime, para o resultado nao misturar "e dela" com "nao e de ninguem".
 */
export function passaResponsavel(
  pessoaId: string,
  raizId: string,
  porRaiz: Map<string, Set<string>>,
): boolean {
  if (!pessoaId) return true;
  return porRaiz.get(raizId)?.has(pessoaId) ?? false;
}

// ====================================================================
// Combinacao
// ====================================================================

/** Ha algum filtro desta spec ativo? Alimenta o contador "X de Y". */
export function temFiltroNovo(
  escopo: FiltroEscopo,
  pessoaId: string,
): boolean {
  return escopo !== "todos" || pessoaId !== "";
}

// =====================================================================
// Painel de filtros do quadro (29/07)
//
// A barra tinha ate SEIS controles soltos na mesma linha do titulo -- busca,
// prazo, ordenacao, subtime, origem e pessoa -- e no quadro de subtime todos
// apareciam de uma vez. O painel recolhe os FILTROS atras de um botao; busca
// e ordenacao ficam de fora de proposito:
//
//   - busca e o controle mais usado, e esconder custa um clique por uso;
//   - ordenacao NAO E FILTRO. Ela nao esconde nada, so muda a ordem. Contar
//     ordenacao como "filtro ativo" faria o badge mentir sobre quantas
//     tarefas estao sendo omitidas.
// =====================================================================

/** O estado dos filtros que o painel recolhe. Ordenacao e busca ficam fora. */
export type EstadoFiltros = {
  prazo: "todos" | "atrasadas" | "em-dia";
  subtime: string;
  escopo: FiltroEscopo;
  pessoa: string;
};

export const FILTROS_LIMPOS: EstadoFiltros = {
  prazo: "todos",
  subtime: "",
  escopo: "todos",
  pessoa: "",
};

/**
 * Quantos filtros estao ESTREITANDO o quadro agora.
 *
 * Alimenta o badge do botao. Conta so o que esconde tarefa: se o numero
 * aparece, existe coisa fora da tela por causa dele. E o antidoto para o
 * problema que o painel cria -- filtro recolhido e filtro esquecido, e
 * "cade minha tarefa?" nasce justamente disso.
 */
export function contaFiltrosAtivos(f: EstadoFiltros): number {
  let n = 0;
  if (f.prazo !== "todos") n++;
  if (f.subtime !== "") n++;
  if (f.escopo !== "todos") n++;
  if (f.pessoa !== "") n++;
  return n;
}

/** Ha algum filtro ligado? Atalho de leitura para o JSX. */
export function temFiltroAtivo(f: EstadoFiltros): boolean {
  return contaFiltrosAtivos(f) > 0;
}
