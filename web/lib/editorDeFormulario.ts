/**
 * Lógica do editor de formulário. Copia regras do backend só para não
 * oferecer o que o servidor recusaria; toda escrita vai ao backend e a
 * mensagem dele é a que aparece.
 */

import type { PerguntaDoEditor, SecaoDoEditor } from "./api";
import { sugereSlug } from "./gestaoTimes";

/** Os seis tipos que o formulário público sabe desenhar. */
export const TIPOS_DE_PERGUNTA: { kind: string; label: string; dica: string }[] = [
  { kind: "texto", label: "Texto curto", dica: "Uma linha" },
  { kind: "textoLongo", label: "Texto longo", dica: "Várias linhas" },
  { kind: "escolha", label: "Escolha uma", dica: "Lista de alternativas" },
  { kind: "multi", label: "Escolha várias", dica: "Marca quantas quiser" },
  { kind: "data", label: "Data", dica: "Calendário" },
  { kind: "link", label: "Link", dica: "Endereço de um arquivo ou site" },
];

const COM_OPCOES = new Set(["escolha", "multi"]);

/** O tipo precisa de uma lista de alternativas? */
export function exigeOpcoes(kind: string): boolean {
  return COM_OPCOES.has(kind);
}

export function nomeDoTipo(kind: string): string {
  return TIPOS_DE_PERGUNTA.find((t) => t.kind === kind)?.label ?? kind;
}

/**
 * As perguntas que podem servir de gatilho para `pergunta`: mesma seção,
 * antes dela, e de escolha (as regras do backend).
 */
export function alvosPossiveis(
  secao: SecaoDoEditor,
  pergunta: PerguntaDoEditor
): PerguntaDoEditor[] {
  const ordenadas = ordenadasPorPosicao(secao.questions);
  const lugar = ordenadas.findIndex((q) => q.id === pergunta.id);
  if (lugar < 0) return [];
  return ordenadas.slice(0, lugar).filter((q) => exigeOpcoes(q.kind));
}

/** As perguntas que só aparecem por causa desta (aviso antes de excluir). */
export function dependentesDe(
  secao: SecaoDoEditor,
  questionId: string
): PerguntaDoEditor[] {
  return secao.questions.filter((q) => q.show_if_question_id === questionId);
}

/** Ordem estável: `position`, e o id como desempate. */
export function ordenadasPorPosicao<T extends { id: string; position: number }>(
  itens: readonly T[]
): T[] {
  return [...itens].sort((a, b) =>
    a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position
  );
}

/**
 * A lista com o item de `indice` movido `passo` casas. Fora da borda devolve
 * a mesma lista, e quem chama usa essa identidade para não chamar a API.
 */
export function movido<T>(itens: readonly T[], indice: number, passo: number): T[] {
  const destino = indice + passo;
  if (indice < 0 || indice >= itens.length) return itens as T[];
  if (destino < 0 || destino >= itens.length) return itens as T[];
  const copia = [...itens];
  const [item] = copia.splice(indice, 1);
  copia.splice(destino, 0, item);
  return copia;
}

/**
 * Mover esta pergunta `passo` casas poria uma dependente antes do gatilho?
 * Devolve o texto do impedimento, ou `null` quando pode mover.
 */
export function impedimentoParaMover(
  secao: SecaoDoEditor,
  indice: number,
  passo: number
): string | null {
  const atual = ordenadasPorPosicao(secao.questions);
  const nova = movido(atual, indice, passo);
  if (nova === atual) return null;
  const lugar = new Map(nova.map((q, i) => [q.id, i]));
  for (const q of nova) {
    if (!q.show_if_question_id) continue;
    const gatilho = lugar.get(q.show_if_question_id);
    if (gatilho === undefined) continue;
    if (gatilho >= lugar.get(q.id)!) {
      return `“${q.label}” só aparece por causa de uma pergunta que ficaria depois dela.`;
    }
  }
  return null;
}

/** Total de perguntas; formulário sem perguntas não pode ser publicado. */
export function contaPerguntas(secoes: readonly SecaoDoEditor[]): number {
  return secoes.reduce((n, s) => n + s.questions.length, 0);
}

/**
 * Sugere o slug de uma seção a partir do título. O slug não muda depois de
 * criado: ele fica gravado em cada pedido (`solicitation_item.category`).
 */
export function sugereSlugDeSecao(titulo: string): string {
  // Mesma regra de slug do time; só o teto muda (60 aqui, 120 no time).
  return sugereSlug(titulo).slice(0, 60);
}
