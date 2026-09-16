// web/lib/edicaoNoLugar.ts
// =====================================================================
// Editar título e descrição da tarefa NO LUGAR, sem abrir modal (Spec 052,
// fatia D -- pedido dela em 16/09, no modelo do Trello).
//
// Fronteira da Spec 027: `lib/` decide, `components/` desenha. Aqui mora o
// "o que salvar" de cada campo; os componentes só perguntam.
// =====================================================================

/** O mesmo teto do servidor (`TaskUpdate.title`). */
export const TITULO_MAXIMO_TAREFA = 255;

export type Decisao = { tipo: "nada" } | { tipo: "salvar"; valor: string };

/**
 * O que fazer com o título ao confirmar (Enter ou clicar fora).
 *
 * ⚠️ TÍTULO VAZIO VOLTA AO ORIGINAL, e não vira erro. Clicar fora é o gesto de
 * desistir tanto quanto o de confirmar: quem apagou tudo e clicou fora não
 * quer ser acusado, quer o título de volta. O servidor recusaria com 422.
 *
 * ⚠️ QUEBRA DE LINHA VIRA ESPAÇO. O campo é um `textarea` (para o título longo
 * quebrar na tela), e colar um texto de várias linhas nele não pode gravar um
 * título com `\n` -- o card do quadro desenharia a quebra.
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
 * O que fazer com a descrição ao confirmar.
 *
 * ⚠️ COMPARA APARADO DOS DOIS LADOS. Uma descrição salva com uma quebra de
 * linha no fim, reaberta e confirmada sem mexer, não é mudança -- e gravar
 * poria no histórico uma edição que não aconteceu.
 *
 * Descrição vazia É válida: apagar a descrição é um gesto legítimo.
 */
export function decidirDescricao(rascunho: string, atual: string | null): Decisao {
  const limpo = rascunho.trim();
  if (limpo === (atual ?? "").trim()) return { tipo: "nada" };
  return { tipo: "salvar", valor: limpo };
}
