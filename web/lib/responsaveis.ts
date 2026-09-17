// lib/responsaveis.ts
// As frases de quando mexer nos responsaveis do DETALHE da tarefa da errado.
//
// ⚠️ NASCEU DE UM DEFEITO VISTO NA TELA (17/09): tirar o ULTIMO responsavel
// mostrava "Essa pessoa nao alcanca esta tarefa (fora do time)". O servidor
// recusa com 422 por DOIS motivos diferentes, e a tela traduzia todo 422 como
// o primeiro:
//   - `details.field = "assignee_ids"`: toda tarefa precisa de pelo menos um
//     responsavel (ADR 0031, `CollaborationService.remove_assignee`);
//   - `details.field = "user_id"`: a pessoa nao alcanca a tarefa.
// O defeito ficou invisivel ate a limpeza de 17/09, porque o detalhe nao
// mostrava erro nenhum.

/** A mesma frase do servidor (`remove_assignee`), para os dois caminhos. */
export const PRECISA_DE_UM_RESPONSAVEL =
  "Toda tarefa precisa de pelo menos um responsável. Escolha outro antes de remover este.";

/**
 * Tirar este responsavel deixaria a tarefa sem ninguem? Devolve a frase, ou
 * `null` quando pode.
 *
 * ⚠️ CONFERE ANTES DE PEDIR: sem isto, a pilula some (otimista), o servidor
 * recusa, e ela volta -- um pisca-pisca para dizer o que a tela ja sabia.
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
