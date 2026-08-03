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
 * "indefinido" = estamos no modo subtime mas NAO da pra classificar (o
 * projeto da tarefa nao esta no mapa, ou nao tem time). Diferente de
 * `undefined`, que significa "fora do modo subtime, a pergunta nao existe".
 *
 * ⚠️ A distincao existe porque as duas situacoes exigem respostas OPOSTAS no
 * filtro: fora do modo subtime, esconder deixaria a tela vazia sem
 * explicacao; DENTRO dele, mostrar em "So internas" e justamente a promessa
 * quebrada que este ajuste conserta.
 */
export type EscopoClassificado = Escopo | "indefinido" | undefined;

/**
 * Classifica a tarefa no quadro de SUBTIME.
 *
 * "interna" = SO o subtime enxerga. E uma promessa de confidencialidade, nao
 * de procedencia (decisao D1 de 03/08/2026).
 *
 * ⚠️ POR QUE O PROJETO MANDA. A visibilidade real esta em
 * `task_guards.py:67-69`: quando a tarefa esta num projeto, o `team_id` DELA
 * e IGNORADO -- quem ve o projeto ve a tarefa. Ate 03/08 esta funcao olhava
 * `task.team_id` sempre, entao tarefa criada com time do CRM dentro de um
 * projeto do Marketing aparecia marcada "Interna" e era visivel pelo
 * workspace inteiro. Sete tarefas em producao nessa situacao.
 *
 * ⚠️ A combinacao (time do CRM + projeto do Marketing) e LEGITIMA e o backend
 * aceita de proposito -- e alguem do CRM organizando trabalho dentro dos
 * projetos do Marketing. O defeito era o ROTULO, nunca a combinacao.
 *
 * `timeDoProjeto`: project_id -> team_id do projeto. Obrigatorio de
 * proposito: opcional aqui seria um chamador esquecido virando pill errada
 * em silencio, e pill errada e o bug que estamos consertando.
 *
 * `undefined` fora do modo subtime (quadro geral e de projeto nao tem a
 * distincao, entao nao mostram pill nem filtro).
 */
export function escopoDaTask(
  task: Pick<TaskMin, "team_id"> & { project_id: string | null },
  subteamId: string | null | undefined,
  timeDoProjeto: ReadonlyMap<string, string | null>,
): EscopoClassificado {
  if (!subteamId) return undefined;
  if (task.project_id !== null) {
    const timeDoProj = timeDoProjeto.get(task.project_id);
    // D3 -- projeto AUSENTE do mapa (lista truncada em 1000, arquivado, ou a
    // chamada falhou). D4 -- projeto SEM time (pessoal, ou comum sem time).
    // Nos dois casos nao da pra prometer nada: sem pill, e fora do filtro
    // especifico. Cair de volta em `task.team_id` aqui reintroduziria a
    // mentira, so que intermitente -- o pior tipo, porque nao reproduz.
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
  // Fora do modo subtime nao ha escopo definido: um filtro especifico nao
  // pode esconder tudo, entao trata como "nao se aplica" e deixa passar.
  if (escopo === undefined) return true;
  // ⚠️ DENTRO do modo subtime, "indefinido" e o oposto: nao sabemos se o
  // subtime e o unico que ve, entao "So internas" NAO pode mostrar. O custo
  // de esconder e um card a menos numa visao filtrada; o de mostrar e repetir
  // a promessa de confidencialidade que este ajuste veio consertar.
  if (escopo === "indefinido") return false;
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
 * ⚠️ A regra e OU (UNIAO), decidida em 03/08/2026. Com Beatriz e Clara
 * marcadas, passa a tarefa da Beatriz, a da Clara E a das duas. O "E"
 * (intersecao) mostraria so a ultima -- e quando a gestao marca duas pessoas
 * a pergunta e "o que essas duas estao tocando", nao "o que elas dividem".
 * Trocar para "E" e uma linha (`every` no lugar de `some`), mas e mudanca de
 * PRODUTO: nao troque sem pedir.
 *
 * Lista vazia = sem filtro. Raiz cuja subarvore inteira nao tem NENHUM
 * responsavel some quando ha filtro -- mesma decisao ja tomada para o filtro
 * de subtime, para o resultado nao misturar "e dela" com "nao e de ninguem".
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

/** Ha algum filtro desta spec ativo? Alimenta o contador "X de Y". */
export function temFiltroNovo(
  escopo: FiltroEscopo,
  pessoaIds: readonly string[],
): boolean {
  return escopo !== "todos" || pessoaIds.length > 0;
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
  // Multi-selecao (03/08/2026): UNIAO. Ver passaResponsavel.
  pessoas: readonly string[];
  // Spec 031 (C3). Os dois entraram porque MUDAM O QUE APARECE e ficavam de
  // fora da conta: com a busca preenchida o badge dizia "0", e o checkbox de
  // arquivadas nunca apareceu em lugar nenhum. Eram dois furos no antidoto.
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

/**
 * Tira acento e caixa pra busca casar "midia" com "Midia Paga".
 *
 * Estava duplicado como `normalizar` local no Board; com "Minhas tarefas"
 * ganhando busca (C3), viraria a segunda copia -- e duas buscas com regra
 * diferente e um bug esperando. Fronteira da Spec 027: e decisao, mora aqui.
 */
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
 * Os filtros ligados AGORA, em ordem estavel, prontos para virar pastilha.
 *
 * Isto substitui o badge numerico. O numero dizia QUANTOS; a pastilha diz
 * QUAIS e desfaz em um clique. Filtro recolhido e filtro esquecido, e
 * "cade minha tarefa?" nasce dai -- um "2" nao responde a pergunta, "Equipe:
 * Midia Paga ✕" responde.
 *
 * Id sem nome no mapa nao vira uuid na tela: cai para um rotulo generico.
 * Acontece de verdade -- o membro pode ter saido do time depois do filtro.
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
    // UMA pastilha, nao uma por pessoa: com quatro marcadas a linha das
    // pastilhas viraria a propria barra de filtros de novo -- o problema que
    // o painel resolveu. O ✕ limpa TODAS; desmarcar uma e no painel.
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
 * Quantos filtros estao ESTREITANDO o quadro agora.
 *
 * ⚠️ NAO e o mesmo que `listaFiltrosAtivos().length`, e a diferenca e de
 * proposito: "incluindo arquivadas" ALARGA o quadro, nao estreita. Ela vira
 * pastilha (e estado que a pessoa quer ver e desfazer) mas nao entra na conta
 * de "quanta coisa esta escondida de mim". Contar tudo faria o numero subir
 * quando a pessoa passa a ver MAIS -- exatamente o contrario do que o
 * contador promete.
 */
export function contaFiltrosAtivos(f: EstadoFiltros): number {
  return listaFiltrosAtivos(f).filter((c) => c.campo !== "arquivadas").length;
}

/** Ha algum filtro ligado? Atalho de leitura para o JSX. */
export function temFiltroAtivo(f: EstadoFiltros): boolean {
  return contaFiltrosAtivos(f) > 0;
}
