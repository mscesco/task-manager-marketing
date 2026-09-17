// web/lib/criacaoTarefa.ts
// =====================================================================
// Regras de criacao de tarefa e de subtarefa (29/07).
//
// A regra e a MESMA nos dois lugares -- titulo e responsavel obrigatorios,
// prazo opcional -- por isso um modulo so. O TaskModal (tarefa raiz) e o
// formulario rapido do TaskDetail (subtarefa) perguntam aqui.
//
// O PROBLEMA, MEDIDO
// Consulta no banco de producao em 29/07, tarefas ativas sem NENHUM
// responsavel:
//
//   subtarefa    BACKLOG        26
//   subtarefa    COMPLETED      15   <- alguem fez, e nao se sabe quem
//   subtarefa    IN_PROGRESS     2
//   subtarefa    PLANNED         1
//   tarefa raiz  (todas)          6
//
// 44 de 50 sao subtarefas -- 88%. E nao e descuido das pessoas: o campo de
// criacao rapida aceitava SO o titulo, entao designar alguem exigia criar,
// abrir e editar. O atalho que a equipe encontrou foi designar todo mundo na
// TAREFA-MAE (ha cards com treze responsaveis), o que desmonta a leitura de
// quem faz o que -- justamente a metrica usada para medir carga.
//
// As 15 concluidas sem responsavel sao o custo ja pago: aquele trabalho nao
// entra na contagem por pessoa de ninguem.
//
// A REGRA
// Responsavel obrigatorio; prazo opcional. Prazo em branco e uma decisao
// legitima ("faz quando der"); responsavel em branco nunca e -- alguem vai
// ter que fazer, e se ninguem sabe quem, a subtarefa nao esta pronta pra
// existir.
//
// A trava vive no FRONT, nao no backend. O endpoint segue aceitando criar sem
// responsavel de proposito: exigir no `POST /tasks` travaria automacao pelo
// n8n e a triagem de solicitacao (que hoje so marca `task_ref` e depende de
// alguem criar a tarefa a mao). Trava de front e reversivel e nao fecha porta.
// =====================================================================

export type Rascunho = {
  titulo: string;
  assigneeIds: string[];
  dueDate: string; // "" = sem prazo
};

/** Motivo pelo qual ainda nao da pra criar. `null` = pode criar. */
export function motivoNaoCria(r: Rascunho): string | null {
  if (!r.titulo.trim()) return "Escreva o título da subtarefa.";
  if (r.assigneeIds.length === 0) return "Escolha quem vai fazer.";
  return null;
}

export function podeCriar(r: Rascunho): boolean {
  return motivoNaoCria(r) === null;
}

/**
 * O que o Enter no campo de TITULO deve fazer.
 *
 * Nao e detalhe de teclado: e a mesma armadilha que criava tarefa sem
 * responsavel no TaskModal. Com titulo preenchido e ninguem escolhido, o
 * Enter tem de LEVAR AO SELETOR -- criar seria repetir o bug, e nao fazer
 * nada deixaria a pessoa presa sem entender por que.
 *
 *   "criar"     -> titulo e responsavel prontos
 *   "escolher"  -> titulo pronto, falta responsavel
 *   "nada"      -> titulo vazio (nada a fazer ainda)
 */
export type AcaoDoEnter = "criar" | "escolher" | "nada";

export function acaoDoEnterNoTitulo(r: Rascunho): AcaoDoEnter {
  if (!r.titulo.trim()) return "nada";
  if (r.assigneeIds.length === 0) return "escolher";
  return "criar";
}

/**
 * Depois de criar em sequencia: o formulario volta VAZIO.
 *
 * ⚠️ MUDOU EM 05/08/2026, e a versao anterior preservava responsavel e prazo.
 * A aposta de entao era o caso comum "decompor trabalho da mesma pessoa, para
 * o mesmo prazo": digitar titulo, Enter, titulo, Enter. Medido na tela, a
 * aposta estava errada -- a segunda subtarefa e OUTRA subtarefa, com outra
 * pessoa, e o campo ja vinha preenchido com quem nao devia. Designar sem
 * querer e pior do que selecionar de novo: o erro nao aparece na hora, e a
 * pessoa errada e que descobre.
 *
 * ⚠️ CUSTO ACEITO: quem cria seis subtarefas para a MESMA pessoa agora
 * seleciona seis vezes. Se isso incomodar mais do que o inverso incomodava,
 * a volta e uma linha -- mas volta como decisao, nao como esquecimento.
 */
export function proximoDaSequencia(_r: Rascunho): Rascunho {
  // ⚠️ Array NOVO, nao o espalhamento de uma constante "vazia": espalhamento
  // e copia RASA e o `assigneeIds` sairia sendo a MESMA referencia da
  // constante -- uma mutacao em qualquer chamador corromperia o "vazio" de
  // todo mundo.
  return { titulo: "", assigneeIds: [], dueDate: "" };
}

/**
 * Alterna uma pessoa na selecao.
 *
 * Multiplos responsaveis sao permitidos -- o modelo suporta e a tarefa mae
 * tambem. Mas o fluxo rapido e otimizado para UM: escolher a primeira ja
 * libera o botao. Quem precisa de mais clica de novo.
 */
export function alternaResponsavel(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Acrescenta TODOS os `disponiveis` a selecao, sem perder quem ja estava.
 *
 * ⚠️ ELE SOMA, E NAO SUBSTITUI, e a diferenca aparece com a busca ativa: a
 * lista de `disponiveis` que a tela passa e a FILTRADA. Substituindo, digitar
 * "ana" e clicar em "selecionar todos" APAGARIA quem ja estava escolhido e nao
 * casa com "ana" -- destruir selecao num botao chamado "selecionar" seria o
 * oposto do que ele promete.
 *
 * ⚠️ DEDUP na volta: `disponiveis` pode conter quem ja esta em `ids`.
 */
export function comTodosOsResponsaveis(
  ids: readonly string[],
  disponiveis: readonly string[],
): string[] {
  return Array.from(new Set([...ids, ...disponiveis]));
}

/**
 * Todos os `disponiveis` ja estao escolhidos?
 *
 * ⚠️ LISTA VAZIA DEVOLVE `false`, de proposito. "Todos de zero pessoas estao
 * escolhidos" e verdade logica e mentira de interface: com a busca sem
 * resultado, `true` esconderia o botao por um motivo que a pessoa nao tem como
 * deduzir. A tela ja trata o vazio com "Ninguem encontrado".
 */
export function todosJaEscolhidos(
  ids: readonly string[],
  disponiveis: readonly string[],
): boolean {
  if (disponiveis.length === 0) return false;
  return disponiveis.every((id) => ids.includes(id));
}

/** Rotulo do botao/resumo da selecao. */
export function resumoResponsaveis(
  ids: readonly string[],
  nomePor: (id: string) => string | undefined
): string {
  if (ids.length === 0) return "Atribuir";
  if (ids.length === 1) return nomePor(ids[0]) ?? "1 pessoa";
  return `${ids.length} pessoas`;
}
