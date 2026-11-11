/**
 * Junta todas as paginas de uma listagem paginada (o backend tem teto de 100
 * por pagina).
 *
 * Auditoria 11/11: o detalhe da tarefa pedia so a primeira pagina dos
 * comentarios, que e a dos MAIS ANTIGOS -- e a tela mostra o mais novo em
 * cima. Acima de 100 (respostas contam), a recarga sumia justo com os
 * recentes. Dedupe por id: alguem pode comentar entre uma pagina e outra.
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
