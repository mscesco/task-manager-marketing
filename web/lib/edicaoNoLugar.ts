// Editar título e descrição da tarefa no lugar, sem modal: o que salvar de
// cada campo.

/** O mesmo teto do servidor (`TaskUpdate.title`). */
export const TITULO_MAXIMO_TAREFA = 255;

export type Decisao = { tipo: "nada" } | { tipo: "salvar"; valor: string };

/**
 * O que fazer com o título ao confirmar (Enter ou clicar fora). Vazio volta
 * ao original; quebra de linha vira espaço (o campo é `textarea`).
 */
export function decidirTitulo(rascunho: string, atual: string): Decisao {
  const limpo = rascunho
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .slice(0, TITULO_MAXIMO_TAREFA);
  if (!limpo || limpo === atual) return { tipo: "nada" };
  return { tipo: "salvar", valor: limpo };
}

/**
 * O que fazer com a descrição ao confirmar. Compara aparado dos dois lados,
 * para não gravar edição que não houve. Vazia é válida.
 */
export function decidirDescricao(rascunho: string, atual: string | null): Decisao {
  const limpo = rascunho.trim();
  if (limpo === (atual ?? "").trim()) return { tipo: "nada" };
  return { tipo: "salvar", valor: limpo };
}
