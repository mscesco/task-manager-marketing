/**
 * A lógica do editor de formulário (Spec 043, fatia C2).
 *
 * ⚠️⚠️ **ESTE ARQUIVO É UMA CÓPIA DELIBERADA DE REGRA DO BACKEND, e isso
 * normalmente é o defeito que esta spec inteira combate.** A justificativa é
 * uma só: aqui as regras servem para **não oferecer** o que o servidor vai
 * recusar — um `<select>` de condicional que lista perguntas inválidas é uma
 * armadilha, não uma liberdade.
 *
 * A decisão que mantém as duas cópias honestas: **o front nunca decide
 * sozinho.** Toda escrita vai ao backend e a mensagem dele é a que aparece.
 * Se um dia as regras divergirem, o pior que acontece é a tela oferecer algo
 * que leva um erro claro — e nunca o contrário, que seria a tela barrar algo
 * que o servidor aceitaria.
 *
 * As três regras da condicional foram MEDIDAS, não inventadas: os 25
 * condicionais herdados do formulário do Marketing foram conferidos um a um
 * antes de virarem código. Todos na mesma seção, todos apontando para trás,
 * todos para uma pergunta de escolha.
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
 * As perguntas que podem servir de gatilho para `pergunta`.
 *
 * ⚠️ AS TRÊS REGRAS DO BACKEND, e é por elas que o `<select>` só mostra o que
 * funciona: mesma seção, ANTES desta, e de escolha. Oferecer as outras seria
 * convidar a pessoa a montar uma condicional que o servidor recusa — ou,
 * pior, uma que ele aceita e que deixa a pergunta invisível para sempre.
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

/**
 * As perguntas que só aparecem por causa desta.
 *
 * ⚠️ É O AVISO ANTES DE EXCLUIR. Some UMA e somem TRÊS — e só a primeira foi
 * pedida. O backend recusa de qualquer forma; mostrar aqui evita que a pessoa
 * descubra por uma caixa vermelha.
 */
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
 * A lista com o item de `indice` movido `passo` casas.
 *
 * ⚠️ DEVOLVE A MESMA LISTA quando o movimento sai da borda, e quem chama usa
 * essa identidade para não disparar uma chamada à toa: subir o primeiro item
 * não é um erro, é um nada.
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
 * Mover esta pergunta `passo` casas quebraria alguma condicional?
 *
 * ⚠️ O QUARTO CAMINHO PARA A PERGUNTA QUE SOME. Arrastar a dependente para
 * cima do gatilho faz dela uma pergunta que se revela por algo ainda não
 * perguntado — e ela nunca mais aparece. O backend recusa; aqui o botão fica
 * desabilitado com o motivo no `title`, que é mais gentil que uma recusa
 * depois do clique.
 *
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

/**
 * O formulário pode ser publicado?
 *
 * ⚠️ A MESMA REGRA DO BACKEND ("um formulário sem perguntas não pode ser
 * publicado"), aqui só para explicar o que falta ANTES do clique. A recusa
 * verdadeira continua sendo a do servidor.
 */
export function contaPerguntas(secoes: readonly SecaoDoEditor[]): number {
  return secoes.reduce((n, s) => n + s.questions.length, 0);
}

/**
 * Sugere o slug de uma seção a partir do título.
 *
 * ⚠️ E ELE É PARA SEMPRE. O slug da seção viaja gravado em cada pedido
 * (`solicitation_item.category`) e é por ele que a fila descobre a categoria;
 * o backend não deixa trocá-lo depois justamente para não abandonar os
 * pedidos antigos como texto cru. A sugestão é editável na hora de criar --
 * e só na hora de criar.
 */
export function sugereSlugDeSecao(titulo: string): string {
  // ⚠️ REAPROVEITA `sugereSlug`, e não repete a regex: a regra do que é slug
  // válido é uma só no produto (`^[a-z0-9-]+$`), e duas cópias dela é
  // exatamente o tipo de divergência que esta spec existe para acabar. Aqui só
  // muda o teto -- 60 na seção, contra 120 no time.
  return sugereSlug(titulo).slice(0, 60);
}
