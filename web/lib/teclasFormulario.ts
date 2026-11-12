// Regras de tecla dentro de um <form>. O HTML submete o form com Enter em
// qualquer <input>; no modal de criar tarefa isso criava a tarefa pela metade
// (Enter na busca de pessoa esperando selecionar).

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
 * Normaliza a caixa: jsdom e SVG podem não devolver em maiúsculas.
 */
export function deveBloquearEnter(tagName: string | null | undefined): boolean {
  const tag = (tagName ?? "").toUpperCase();
  if (tag === "") return true; // sem tag conhecida: bloqueia (lado seguro)
  return !ENTER_E_DO_ELEMENTO.has(tag);
}

/**
 * Atalho explicito de salvar: Ctrl+Enter (Windows/Linux) ou Cmd+Enter (Mac).
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
 * Recebe a lista já filtrada e ordenada; devolve o primeiro id, ou null.
 */
export function primeiroSelecionavel<T extends { id: string }>(
  itens: readonly T[]
): string | null {
  return itens.length > 0 ? itens[0].id : null;
}
