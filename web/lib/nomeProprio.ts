// Editar o próprio nome no /perfil. O servidor apara e recusa vazio; isto só
// evita oferecer "Salvar" para um envio que não muda nada ou volta com erro.

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
