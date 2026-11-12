/**
 * "Esta resposta ainda é a do último pedido para esta chave?" Com dois
 * arrastes seguidos do mesmo card, só o último aplica a resposta ou desfaz.
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
