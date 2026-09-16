// web/lib/nomeProprio.ts
// =====================================================================
// Editar o PRÓPRIO nome, no /perfil (Spec 051, fatia E -- decisão 8).
//
// Fronteira da Spec 027: `lib/` decide, a página desenha. A decisão aqui é
// pequena, e por isso mesmo fácil de espalhar errado pelo JSX: o que conta
// como "mudou", e o que conta como vazio.
//
// ⚠️ O SERVIDOR É QUEM MANDA: ele apara e recusa vazio (422). Isto só evita
// oferecer "Salvar" para um envio que não muda nada ou que vai voltar com erro.
// =====================================================================

/** Mesmo teto do servidor (`RenameSelfRequest.name`, 255). */
export const NOME_MAXIMO = 255;

/**
 * O nome a ENVIAR, ou `null` quando não há o que salvar.
 *
 * `null` em três casos: vazio depois de aparar (o servidor recusaria), igual ao
 * atual depois de aparar (salvar não mudaria nada -- "Ana " e "Ana" são o mesmo
 * nome), e acima do teto.
 */
export function nomeParaSalvar(digitado: string, atual: string): string | null {
  const limpo = digitado.trim();
  if (!limpo) return null;
  if (limpo.length > NOME_MAXIMO) return null;
  if (limpo === atual.trim()) return null;
  return limpo;
}
