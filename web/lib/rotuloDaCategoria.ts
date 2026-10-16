/**
 * Como uma categoria se apresenta na fila (Spec 043, fatia C2-c).
 *
 * ⚠️⚠️ **ATÉ 26/08 ISTO VINHA DE UM ARQUIVO ESTÁTICO NO FRONT.** A fila lia
 * `CATEGORIA_POR_SLUG`, de `web/lib/solicitacaoForm.ts`, para transformar o
 * slug gravado no pedido num título com emoji. A fatia B trocou a fonte do
 * formulário **público** e não a da fila — e ninguém notou, porque a migration
 * 0017 copiou exatamente os mesmos slugs do arquivo.
 *
 * O defeito só apareceria quando alguém usasse o editor da fatia C2: **a
 * primeira seção nova aparece na fila como slug cru e "❓"**, enquanto as
 * antigas continuam bonitas. Nada quebra, nada avisa. É a divergência
 * silenciosa que esta spec inteira existe para acabar.
 *
 * ⚠️ E O RÓTULO É RESOLVIDO PELO BACKEND NA HORA DE MOSTRAR, e não gravado no
 * pedido. É o oposto da regra das RESPOSTAS, que são retrato do dia
 * (`{label, value}`), e a diferença é proposital: renomear "Foto" para
 * "Fotografia" deve arrumar a fila inteira, inclusive o que chegou antes. Por
 * isso o `slug` da seção não pode mudar e o título pode — um é a chave, o
 * outro é a etiqueta.
 */

import type { BatchItem } from "./api";

export type RotuloDeCategoria = {
  titulo: string;
  emoji: string;
  prazo: string | null;
};

/**
 * ⚠️ A RESERVA É O SLUG CRU, e ela precisa continuar existindo.
 *
 * `category_title` vem `null` quando a seção foi apagada, ou quando o pedido é
 * de uma categoria que não existe mais em formulário nenhum. Mostrar o slug é
 * feio e é honesto; esconder o item, ou mostrar vazio, apagaria da tela um
 * pedido que alguém fez de verdade.
 */
export function rotuloDaCategoria(item: BatchItem): RotuloDeCategoria {
  return {
    titulo: item.category_title ?? item.category,
    // ⚠️ O EMOJI VAZIO É UMA ESCOLHA DE QUEM MONTOU A SEÇÃO, e não uma falta:
    // por isso `??` e não `||`. Trocar por "❓" um emoji que a pessoa
    // deliberadamente deixou em branco seria a tela discordando dela.
    emoji: item.category_emoji ?? "❓",
    prazo: item.category_sla,
  };
}

/**
 * " #2" quando o envio traz a MESMA seção mais de uma vez (Spec 059: seção
 * repetível, vários eventos num envio); vazio quando ela aparece uma vez só.
 * A ordem é a do `batch_seq` -- a ordem em que a pessoa preencheu.
 */
export function numeroDaRepeticao(
  items: readonly Pick<BatchItem, "id" | "category" | "batch_seq">[],
  item: Pick<BatchItem, "id" | "category">
): string {
  const irmaos = items
    .filter((i) => i.category === item.category)
    .sort((a, b) => a.batch_seq - b.batch_seq);
  if (irmaos.length < 2) return "";
  return ` #${irmaos.findIndex((i) => i.id === item.id) + 1}`;
}
