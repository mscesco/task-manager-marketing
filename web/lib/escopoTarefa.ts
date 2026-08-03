// Time da tarefa NOVA -- lado do front.
//
// ⚠️ ESTE MODULO ENCOLHEU NA SPEC 034 (03/08). `foraDoEscopo` FOI REMOVIDA.
//
// Ela reconstruia aqui a regra de alcance do backend a partir de `team_id` --
// e `GET /members` nunca devolveu PAPEL. Consequencia, reportada duas vezes com
// captura: gestor e admin sumiam dos seletores em tarefa interna de subtime,
// tanto na tela de detalhe quanto no modal de criar, embora a API aceitasse os
// dois.
//
// Agora quem responde e o backend, com a MESMA funcao que o POST de designacao
// usa (`user_can_view_task` / `user_can_view_team`):
//   tarefa que JA EXISTE -> `listMembers(taskId)`      (?reaches_task=)
//   tarefa a CRIAR       -> `listMembersDoTime(teamId)` (?reaches_team=)
//
// ⚠️ NAO reintroduzir um filtro de escopo aqui. Se aparecer a necessidade,
// e sinal de que falta um parametro na rota -- nao de que o front precisa
// espelhar a arvore de papeis, que foi exatamente o erro desfeito nesta spec.
//
// ⚠️ A dependencia do §7 (pessoa em mais de um subtime) MORREU junto: era o
// `Map<string, string | null>` desta funcao. O backend usa `team_roles`, que
// ja e plural. O §7 segue sem decisao, mas nao pesa mais nesta tela.

/**
 * Time que a tarefa NOVA vai ter, decidido no front antes do POST.
 *
 * Espelha o pin do `createTask` (`lib/api.ts`): quadro de subtime manda
 * `team_id` explicito e a tarefa nasce INTERNA daquele subtime; sem isso,
 * pina na raiz. Existe como funcao nomeada -- e nao como `a ?? b` solto no
 * componente -- porque e um CONTRATO com o `createTask`: se o pin la mudar,
 * o seletor de responsavel aqui passa a oferecer o escopo errado, e o teste
 * deste modulo e o unico lugar que grita.
 */
export function timeDaTarefaNova(
  defaultTeamId: string | null | undefined,
  rootTeamId: string | null
): string | null {
  return defaultTeamId ?? rootTeamId;
}
