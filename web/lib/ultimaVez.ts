/**
 * "Esta resposta ainda e a do ULTIMO pedido para esta chave?"
 *
 * Auditoria 11/11 (item 14): arrastar o mesmo card duas vezes depressa (A->B,
 * B->C) mandava dois PATCH. Se o primeiro respondesse por ultimo -- ou
 * falhasse --, a resposta ou a reversao dele punha o card de volta em B (ou
 * em A) com o servidor dizendo C. Cada pedido pega a sua vez; so a ultima
 * aplica a resposta ou desfaz.
 */
export function criarUltimaVez() {
  const vezes = new Map<string, number>();
  return {
    /** Marca um pedido novo para `chave`; devolve "ainda sou o ultimo?". */
    nova(chave: string): () => boolean {
      const minha = (vezes.get(chave) ?? 0) + 1;
      vezes.set(chave, minha);
      return () => vezes.get(chave) === minha;
    },
  };
}
