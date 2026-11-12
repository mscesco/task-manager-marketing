// As frases de quando mexer nos responsáveis do detalhe da tarefa dá errado.
// O servidor recusa com 422 por dois motivos, distinguidos por `details.field`:
//   - "assignee_ids": toda tarefa precisa de pelo menos um responsável;
//   - "user_id": a pessoa não alcança a tarefa.

/** A mesma frase do servidor (`remove_assignee`), para os dois caminhos. */
export const PRECISA_DE_UM_RESPONSAVEL =
  "Toda tarefa precisa de pelo menos um responsável. Escolha outro antes de remover este.";

/**
 * Tirar este responsavel deixaria a tarefa sem ninguem? Devolve a frase, ou
 * `null` quando pode. Confere antes de pedir, para a
 * pílula otimista não sumir e voltar.
 */
export function bloqueioAoTirar(atuais: readonly string[], userId: string): string | null {
  return atuais.length === 1 && atuais[0] === userId ? PRECISA_DE_UM_RESPONSAVEL : null;
}

/** A frase do aviso quando designar ou tirar um responsavel falha. */
export function mensagemDeFalhaDoResponsavel(erro: {
  status?: number;
  message?: string;
  details?: Record<string, unknown>;
}): string {
  if (erro.status === 403) return "Você não pode designar nesta tarefa.";
  if (erro.status === 422) {
    if (erro.details?.field === "assignee_ids") {
      return erro.message || PRECISA_DE_UM_RESPONSAVEL;
    }
    return "Essa pessoa não alcança esta tarefa (fora do time).";
  }
  return "Não consegui atualizar o responsável.";
}
