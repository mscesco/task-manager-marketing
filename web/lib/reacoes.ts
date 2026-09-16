/**
 * Spec 050 -- as decisoes da fileira de reacoes, sem React.
 *
 * FRONTEIRA (Spec 027): isto e DECISAO, entao mora em `lib/` -- funcao pura,
 * testavel. O componente desenha; nao decide.
 *
 * ESTE ARQUIVO NAO E SEGURANCA: o servidor e quem recusa (404 fora do alcance,
 * 422 no que nao e emoji). Aqui so evitamos oferecer o que ele vai recusar.
 */

import type { Comment } from "./api";

/** Uma pilula: o emoji e quem reagiu com ele, na ordem em que reagiram. */
export type Reacao = Comment["reactions"][number];

/**
 * Os dois que aparecem primeiro, maiores, no seletor -- pedido dela em 15/09
 * (*"recomendando o joia e o coração em primeiro"*).
 *
 * ⚠️ NA FORMA COMPLETA. `❤️` sem o U+FE0F e outra sequencia, e o servidor
 * normaliza -- a pilula voltaria com um emoji diferente do que o botao mostrou.
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
 * "Ana, Bruno e você" -- quem reagiu, para o titulo da pilula.
 *
 * ⚠️ "VOCE" VAI POR ULTIMO, e nao na ordem em que reagiu: a frase e lida por
 * quem esta olhando, e "você, Ana" soa como se a pessoa fosse a primeira.
 *
 * ⚠️ Quem nao esta no mapa de membros (saiu da empresa, ou a lista ainda nao
 * carregou) entra como "alguém" -- nunca como id cru na tela.
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
 * Busca no catalogo: casa no nome E nas etiquetas, sem acento e sem caixa.
 *
 * ⚠️ SEM ACENTO DOS DOIS LADOS. "coracao" tem de achar "coração", senao a
 * busca exige que a pessoa acerte o acento de uma palavra que ela nao ve.
 *
 * ⚠️ `limite` existe porque a grade desenha o que voltar: 1.949 emojis de uma
 * vez sao 1.949 botoes no DOM. Busca vazia devolve `[]` -- quem chama mostra
 * os grupos, e nao "tudo".
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

/**
 * O catalogo em grupos, na ordem em que os grupos aparecem nele.
 *
 * ⚠️ A ORDEM VEM DO ARQUIVO GERADO, e nao de uma lista escrita aqui: ela e a
 * do proprio Unicode (sorrisos primeiro, bandeiras no fim). Uma segunda lista
 * divergiria no dia em que um grupo novo aparecesse.
 */
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
