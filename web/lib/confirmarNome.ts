// "Digite o nome para confirmar": a regra de excluir quadro e base.

/**
 * O nome digitado confere com o do item? Maiúscula conta (o diálogo existe
 * para a pessoa ler o nome); `trim` nas duas pontas porque o backend grava
 * com `strip()`; nome vazio nunca confere.
 */
export function nomeConfere(digitado: string, nome: string): boolean {
  const limpo = digitado.trim();
  return limpo.length > 0 && limpo === nome.trim();
}
