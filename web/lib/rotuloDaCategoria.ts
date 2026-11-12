/**
 * Como uma categoria se apresenta na fila. O rótulo é resolvido pelo backend
 * na hora de mostrar (renomear a seção arruma a fila inteira); o `slug` é a
 * chave e não muda.
 */

import type { BatchItem } from "./api";

export type RotuloDeCategoria = {
  titulo: string;
  emoji: string;
  prazo: string | null;
};

/**
 * `category_title` vem `null` quando a seção foi apagada; aí aparece o slug
 * cru, para o pedido não sumir da tela.
 */
export function rotuloDaCategoria(item: BatchItem): RotuloDeCategoria {
  return {
    titulo: item.category_title ?? item.category,
    // `??` e não `||`: emoji vazio é escolha de quem montou a seção.
    emoji: item.category_emoji ?? "❓",
    prazo: item.category_sla,
  };
}

/**
 * " #2" quando o envio traz a mesma seção mais de uma vez; vazio quando ela
 * aparece uma vez só.
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
