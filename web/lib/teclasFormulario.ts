// web/lib/teclasFormulario.ts
// =====================================================================
// Regras de tecla dentro de um <form> (dominio do front -- Spec 027).
//
// PROBLEMA QUE ISTO RESOLVE
// O HTML tem "submit implicito": Enter em qualquer <input> dentro de um form
// que tenha botao submit envia o formulario. No modal de criar tarefa isso
// fazia a tarefa nascer com o que estivesse preenchido no instante do Enter --
// tipicamente so o titulo. O caso pior era o campo "Buscar pessoa...": a
// pessoa digitava o nome, apertava Enter esperando SELECIONAR, e o form
// submetia com assignee_ids vazio. A tarefa nascia sem responsavel, com o
// mesmo sintoma do bug que a Spec 021 ja tinha atacado pelo outro lado.
//
// Estas funcoes sao puras de proposito: o componente pergunta, elas respondem,
// e o teste cobre a regra sem renderizar nada.
// =====================================================================

/** Elementos em que o Enter tem significado proprio e NAO deve ser bloqueado. */
const ENTER_E_DO_ELEMENTO = new Set(["TEXTAREA", "BUTTON"]);

/**
 * O Enter neste elemento deve ser bloqueado (preventDefault)?
 *
 * - TEXTAREA -> false. Enter e quebra de linha; bloquear quebraria a descricao.
 * - BUTTON   -> false. Enter num botao focado e o clique dele -- inclusive o
 *               proprio submit, que continua funcionando por teclado.
 * - resto    -> true.  input de texto, date, checkbox, select: o Enter ali e
 *               sempre acidente, nunca intencao de salvar.
 *
 * `tagName` vem de `e.target.tagName`, que o DOM devolve em MAIUSCULAS -- mas
 * normalizamos porque jsdom e SVG podem devolver de outro jeito.
 */
export function deveBloquearEnter(tagName: string | null | undefined): boolean {
  const tag = (tagName ?? "").toUpperCase();
  if (tag === "") return true; // sem tag conhecida: bloqueia (lado seguro)
  return !ENTER_E_DO_ELEMENTO.has(tag);
}

/**
 * Atalho explicito de salvar: Ctrl+Enter (Windows/Linux) ou Cmd+Enter (Mac).
 *
 * Devolve a intencao que o Enter sozinho tinha antes, mas agora de forma
 * deliberada -- quem gostava de "digitar e mandar" nao perde a velocidade.
 */
export function ehAtalhoDeSalvar(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return e.key === "Enter" && (e.ctrlKey === true || e.metaKey === true);
}

/**
 * Enter no campo de busca de pessoa: qual item selecionar?
 *
 * Recebe a lista JA filtrada e ordenada (o componente monta com useMemo) e
 * devolve o id do primeiro, ou null se a busca nao achou ninguem. Trocar um
 * comportamento surpreendente (submete o form) por um inerte (nao faz nada)
 * seria consertar pela metade: o que a pessoa espera do Enter ali e escolher.
 */
export function primeiroSelecionavel<T extends { id: string }>(
  itens: readonly T[]
): string | null {
  return itens.length > 0 ? itens[0].id : null;
}
