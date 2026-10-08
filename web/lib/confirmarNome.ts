// lib/confirmarNome.ts
// "Digite o nome para confirmar" -- a regra de excluir quadro e de excluir
// base (Spec 056, D26). Eram duas copias, e tinham divergido: a da Base
// aceitava nome vazio (revisao de 07/10).

/**
 * O nome digitado confere com o do item?
 *
 * ⚠️ MAIUSCULA CONTA: o dialogo existe para a pessoa LER o nome do que vai
 * apagar; aceitar "quadro crm" para "Quadro CRM" afrouxaria justamente o passo
 * que faz ela olhar.
 *
 * ⚠️ `trim` NAS DUAS PONTAS porque o backend grava com `strip()` -- um espaco
 * colado ao nome nao pode virar recusa que a pessoa nao consegue ver.
 *
 * ⚠️ NOME VAZIO NUNCA CONFERE. Sem esta regra, abrir o dialogo e confirmar sem
 * digitar nada apagaria um item de nome vazio -- que o backend nao deixa
 * existir, mas a regra nao deve depender disso.
 */
export function nomeConfere(digitado: string, nome: string): boolean {
  const limpo = digitado.trim();
  return limpo.length > 0 && limpo === nome.trim();
}
