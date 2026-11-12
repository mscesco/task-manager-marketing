/**
 * Filtros do quadro: escopo (interna x compartilhada), responsável e busca.
 *
 * O card do quadro é sempre a raiz, então uma raiz passa se ELA ou QUALQUER
 * subtarefa dela satisfaz o critério.
 */

/** Tarefa, no minimo que estes filtros precisam. */
export type TaskMin = {
  id: string;
  parent_task_id: string | null;
  team_id: string | null;
  assignee_ids?: string[];
  // Responsáveis da subárvore, agregados pelo backend. `undefined` = a
  // resposta não trouxe; cai no caminhamento pela lista carregada.
  subtree_assignee_ids?: string[];
};

// ====================================================================
// 1. ESCOPO -- interna x compartilhada
// ====================================================================

export type FiltroEscopo = "todos" | "interna" | "compartilhada";

export type Escopo = "interna" | "compartilhada";

/**
 * "indefinido" = no modo subtime, mas não dá para classificar. `undefined` =
 * fora do modo subtime. O filtro trata os dois de forma oposta.
 */
export type EscopoClassificado = Escopo | "indefinido" | undefined;

/**
 * Classifica a tarefa no quadro de subtime. "interna" = só o subtime enxerga.
 * Quando a tarefa está num projeto, a visibilidade é a do projeto e o
 * `team_id` dela é ignorado (`task_guards.py`); por isso o time do projeto
 * manda. `undefined` fora do modo subtime.
 */
export function escopoDaTask(
  task: Pick<TaskMin, "team_id"> & { project_id: string | null },
  subteamId: string | null | undefined,
  timeDoProjeto: ReadonlyMap<string, string | null>,
): EscopoClassificado {
  if (!subteamId) return undefined;
  if (task.project_id !== null) {
    const timeDoProj = timeDoProjeto.get(task.project_id);
    // Projeto fora do mapa ou sem time: não dá para prometer nada. Não cair em
    // `task.team_id`, que daria rótulo errado de forma intermitente.
    if (!timeDoProj) return "indefinido";
    return timeDoProj === subteamId ? "interna" : "compartilhada";
  }
  // Avulsa: nao ha projeto, entao o time da tarefa E a lente.
  return task.team_id === subteamId ? "interna" : "compartilhada";
}

/** A pill do card so aceita escopo REAL -- "indefinido" nao desenha nada. */
export function pillDoEscopo(escopo: EscopoClassificado): Escopo | undefined {
  return escopo === "indefinido" ? undefined : escopo;
}

/** O escopo passa no filtro escolhido? `todos` sempre passa. */
export function passaEscopo(
  filtro: FiltroEscopo,
  escopo: EscopoClassificado,
): boolean {
  if (filtro === "todos") return true;
  // Fora do modo subtime o filtro não se aplica.
  if (escopo === undefined) return true;
  // Sem saber quem vê, "Só internas" não pode mostrar.
  if (escopo === "indefinido") return false;
  return escopo === filtro;
}

// ====================================================================
// 2. RESPONSAVEL -- "o que a fulana esta fazendo"
// ====================================================================

/**
 * Sobe da tarefa até a raiz visível no conjunto carregado (para no topo
 * disponível se o pai não veio). Guarda anti-ciclo por id visitado.
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

/** `id_da_raiz -> Set<user_id>` com todos os responsáveis da subárvore. */
export function responsaveisPorRaiz(
  tasks: TaskMin[],
): Map<string, Set<string>> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, Set<string>>();
  for (const t of tasks) {
    // Com `subtree_assignee_ids` o backend já agregou (raiz inclusa). O
    // caminhamento abaixo ainda serve a `/minhas-tarefas`, que traz subtarefa
    // como card solto.
    const daSubarvore = t.subtree_assignee_ids;
    if (daSubarvore !== undefined) {
      if (daSubarvore.length === 0) continue;
      let set = out.get(t.id);
      if (!set) {
        set = new Set<string>();
        out.set(t.id, set);
      }
      for (const id of daSubarvore) set.add(id);
      continue;
    }
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

// ====================================================================
// 3. BUSCA POR TITULO -- inclui SUBTAREFA
// ====================================================================

/** Tarefa com titulo -- o minimo que a busca precisa. */
export type TaskComTitulo = TaskMin & { title: string };

/**
 * Raízes cujo título, ou o de alguma subtarefa, casa com a busca. Só título,
 * e só o que foi carregado (lista com teto, arquivadas só quando pedidas).
 */
export function raizesQueCasamBusca(
  tasks: readonly TaskComTitulo[],
  buscaNorm: string,
): Set<string> {
  const out = new Set<string>();
  if (buscaNorm === "") return out;
  const byId = new Map(tasks.map((t) => [t.id, t as TaskMin]));
  for (const t of tasks) {
    if (!normalizarBusca(t.title).includes(buscaNorm)) continue;
    out.add(raizDe(t, byId));
  }
  return out;
}

/**
 * A raiz passa no filtro por pessoa? A regra é OU: com duas pessoas marcadas,
 * passa o que for de qualquer uma. Lista vazia = sem filtro; raiz sem nenhum
 * responsável some quando há filtro.
 */
export function passaResponsavel(
  pessoaIds: readonly string[],
  raizId: string,
  porRaiz: Map<string, Set<string>>,
): boolean {
  if (pessoaIds.length === 0) return true;
  const doRaiz = porRaiz.get(raizId);
  if (!doRaiz) return false;
  return pessoaIds.some((id) => doRaiz.has(id));
}

// ====================================================================
// Combinacao
// ====================================================================

/** Há filtro de escopo ou pessoa ativo? Alimenta o contador "X de Y". */
export function temFiltroNovo(
  escopo: FiltroEscopo,
  pessoaIds: readonly string[],
): boolean {
  return escopo !== "todos" || pessoaIds.length > 0;
}

// =====================================================================
// Painel de filtros do quadro. Ordenação não é filtro (não esconde nada).
// =====================================================================

/** O estado dos filtros do painel. Ordenação fica fora. */
export type EstadoFiltros = {
  prazo: "todos" | "atrasadas" | "em-dia";
  subtime: string;
  escopo: FiltroEscopo;
  pessoas: readonly string[];
  busca: string;
  arquivadas: boolean;
};

export const FILTROS_LIMPOS: EstadoFiltros = {
  prazo: "todos",
  subtime: "",
  escopo: "todos",
  pessoas: [],
  busca: "",
  arquivadas: false,
};

/** Tira acento e caixa pra busca casar "midia" com "Midia Paga". */
export function normalizarBusca(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Uma pastilha de filtro ligado: o rotulo que aparece e o campo que o ✕ limpa. */
export type ChipFiltro = {
  campo: keyof EstadoFiltros;
  rotulo: string;
};

/** Mapas id -> nome, para o chip dizer "Equipe: Midia Paga" e nao um uuid. */
export type NomesDeFiltro = {
  subtimes?: Map<string, string>;
  pessoas?: Map<string, string>;
};

const ROTULO_PRAZO: Record<string, string> = {
  atrasadas: "Atrasadas",
  "em-dia": "Em dia",
};
const ROTULO_ESCOPO: Record<string, string> = {
  interna: "Só internas",
  compartilhada: "Só compartilhadas",
};

// Busca longa vira "..." -- o chip mora numa linha que ja compete com outros.
const MAX_BUSCA_NO_CHIP = 24;

/**
 * Os filtros ligados agora, em ordem estável, prontos para virar pastilha.
 * Id sem nome no mapa cai num rótulo genérico (o membro pode ter saído).
 */
export function listaFiltrosAtivos(
  f: EstadoFiltros,
  nomes: NomesDeFiltro = {}
): ChipFiltro[] {
  const chips: ChipFiltro[] = [];
  const busca = f.busca.trim();
  if (busca !== "") {
    const curta =
      busca.length > MAX_BUSCA_NO_CHIP
        ? busca.slice(0, MAX_BUSCA_NO_CHIP) + "…"
        : busca;
    chips.push({ campo: "busca", rotulo: `Busca: ${curta}` });
  }
  if (f.prazo !== "todos") {
    chips.push({ campo: "prazo", rotulo: ROTULO_PRAZO[f.prazo] ?? f.prazo });
  }
  if (f.subtime !== "") {
    const nome = nomes.subtimes?.get(f.subtime);
    chips.push({ campo: "subtime", rotulo: `Equipe: ${nome ?? "outra equipe"}` });
  }
  if (f.escopo !== "todos") {
    chips.push({ campo: "escopo", rotulo: ROTULO_ESCOPO[f.escopo] ?? f.escopo });
  }
  if (f.pessoas.length > 0) {
    // Uma pastilha só para todas as pessoas; o ✕ limpa todas.
    const primeiro = nomes.pessoas?.get(f.pessoas[0]) ?? "outra pessoa";
    const resto = f.pessoas.length - 1;
    chips.push({
      campo: "pessoas",
      rotulo:
        resto === 0
          ? `Responsável: ${primeiro}`
          : `Responsáveis: ${primeiro} +${resto}`,
    });
  }
  if (f.arquivadas) {
    chips.push({ campo: "arquivadas", rotulo: "Incluindo arquivadas" });
  }
  return chips;
}

/**
 * Quantos filtros estão estreitando o quadro. "Incluindo arquivadas" alarga,
 * então vira pastilha mas não entra na conta.
 */
export function contaFiltrosAtivos(f: EstadoFiltros): number {
  return listaFiltrosAtivos(f).filter((c) => c.campo !== "arquivadas").length;
}
