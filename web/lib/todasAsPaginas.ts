/**
 * Junta todas as páginas de uma listagem paginada (o backend tem teto de 100
 * por página). Dedupe por id: um item pode entrar entre uma página e outra.
 */
export async function todasAsPaginas<T extends { id: string }>(
  buscar: (page: number, size: number) => Promise<{ items: T[]; total: number }>,
  size = 100,
): Promise<T[]> {
  const vistos = new Set<string>();
  const itens: T[] = [];
  for (let page = 1; ; page++) {
    const r = await buscar(page, size);
    for (const it of r.items) {
      if (!vistos.has(it.id)) {
        vistos.add(it.id);
        itens.push(it);
      }
    }
    if (r.items.length < size || page * size >= r.total) return itens;
  }
}
