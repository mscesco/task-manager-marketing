/**
 * Regras da fileira de reações. Não é segurança: o servidor recusa (404 fora
 * do alcance, 422 no que não é emoji); aqui só se evita oferecer.
 */

import type { Comment } from "./api";

/** Uma pilula: o emoji e quem reagiu com ele, na ordem em que reagiram. */
export type Reacao = Comment["reactions"][number];

/**
 * Os dois que aparecem primeiro no seletor. Na forma completa: `❤️` sem o
 * U+FE0F é outra sequência, e o servidor normaliza.
 */
export const REACOES_SUGERIDAS = ["👍", "❤️"] as const;

/** Um emoji do catalogo gerado (`emojiCatalogo.generated.ts`). */
export type EmojiDoCatalogo = {
  /** Na forma que o servidor grava (ver o gerador). */
  readonly emoji: string;
  /** Nome em portugues -- "polegar para cima". */
  readonly nome: string;
  /** Etiquetas em portugues, para a busca -- "joia", "beleza", "valeu". */
  readonly tags: readonly string[];
  /** Nome do grupo, em portugues -- "sorrisos e emoção". */
  readonly grupo: string;
};

/** Com qual emoji EU reagi neste comentario? `null` se nao reagi. */
export function minhaReacao(
  reactions: readonly Reacao[],
  meuId: string | null | undefined,
): string | null {
  if (!meuId) return null;
  const minha = reactions.find((r) => r.user_ids.includes(meuId));
  return minha ? minha.emoji : null;
}

/**
 * O que o clique numa pilula faz.
 *
 * Atalho do Slack/GitHub para "+1" sem abrir o seletor: clicar na PROPRIA
 * reacao tira; clicar na de outro emoji troca a minha para ele.
 */
export function acaoDaPilula(
  reactions: readonly Reacao[],
  emoji: string,
  meuId: string | null | undefined,
): "tirar" | "por" {
  return minhaReacao(reactions, meuId) === emoji ? "tirar" : "por";
}

/**
 * "Ana, Bruno e você" -- quem reagiu, para o título da pílula. "você" vai
 * por último; quem não está no mapa de membros vira "alguém".
 */
export function rotuloDeQuemReagiu(
  userIds: readonly string[],
  nomePorId: ReadonlyMap<string, { name: string }>,
  meuId: string | null | undefined,
): string {
  const outros = userIds
    .filter((id) => id !== meuId)
    .map((id) => nomePorId.get(id)?.name?.trim() || "alguém");
  const nomes = userIds.some((id) => id === meuId)
    ? [...outros, "você"]
    : outros;
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Busca no catálogo: casa no nome e nas etiquetas, sem acento e sem caixa dos
 * dois lados. `limite` porque a grade desenha um botão por resultado. Busca
 * vazia devolve `[]` (quem chama mostra os grupos).
 */
export function filtrarCatalogo(
  catalogo: readonly EmojiDoCatalogo[],
  termo: string,
  limite = 60,
): EmojiDoCatalogo[] {
  const alvo = semAcento(termo);
  if (!alvo) return [];
  const achados: EmojiDoCatalogo[] = [];
  for (const item of catalogo) {
    const casa =
      semAcento(item.nome).includes(alvo) ||
      item.tags.some((t) => semAcento(t).includes(alvo));
    if (casa) achados.push(item);
    if (achados.length >= limite) break;
  }
  return achados;
}

function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** O catálogo em grupos, na ordem em que aparecem no arquivo gerado (a do
 *  Unicode). */
export function porGrupo(
  catalogo: readonly EmojiDoCatalogo[],
): { grupo: string; itens: EmojiDoCatalogo[] }[] {
  const grupos: { grupo: string; itens: EmojiDoCatalogo[] }[] = [];
  const indice = new Map<string, number>();
  for (const item of catalogo) {
    const at = indice.get(item.grupo);
    if (at === undefined) {
      indice.set(item.grupo, grupos.length);
      grupos.push({ grupo: item.grupo, itens: [item] });
    } else {
      grupos[at].itens.push(item);
    }
  }
  return grupos;
}
