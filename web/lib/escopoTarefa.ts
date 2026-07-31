// Quem ALCANCA uma tarefa -- lado do front.
//
// O backend ja recusa designar quem nao alcanca (422, `collaboration_service
// ._assert_target_reaches_task`). O problema nunca foi a trava: era a UI
// OFERECER a pessoa e so avisar depois do clique. Em mencao nem isso acontece
// -- o @ aceita qualquer nome e a notificacao vai pra quem nao consegue abrir
// a tarefa.
//
// A regra do backend e VISIBILIDADE, nao "mesmo subtime":
//   SUPERVISOR/OPERATOR de X enxergam  X + a raiz   (team_scope.py)
//   MANAGER/ADMIN de T enxergam        T + descendentes
// Ou seja:
//   tarefa da RAIZ    -> todo mundo do workspace alcanca. NAO filtrar nada:
//                        designar alguem de outra area numa tarefa geral e
//                        trabalho legitimo, nao engano.
//   tarefa de SUBTIME -> so quem esta naquele subtime (ver a ressalva abaixo).
//
// ⚠️ RESSALVA MEDIDA -- gestor e admin.
// A regra real do backend deixa MANAGER/ADMIN do time acima designarem em
// tarefa interna de subtime. Este modulo NAO consegue reproduzir isso: o
// `GET /members` devolve `team_id` (um subtime, ou null) e NAO devolve papel.
// Descobrir papel exige `GET /members/{id}/teams`, uma chamada POR PESSOA.
// Consequencia aceita: gestor/admin some do seletor de tarefa interna de
// subtime. Quem JA esta designado continua na lista (senao nao haveria como
// desdesignar). Se isso incomodar, o conserto certo e no backend -- um
// parametro em GET /members que reuse `_assert_target_reaches_task` -- e nao
// espelhar a arvore de papeis aqui.
//
// ⚠️ Isto le `Map<string, string | null>`: UM subtime por pessoa. Quando a
// conversa do §7 (pessoa em dois subtimes) andar, este mapa vira conjunto e
// a comparacao aqui vira `.has(taskTeamId)`. E o unico ponto a mudar.

/**
 * Ids que NAO devem ser oferecidos para designar/mencionar nesta tarefa.
 *
 * Devolve conjunto VAZIO (nao filtra nada) quando:
 *   - a tarefa e da raiz, ou
 *   - o id da raiz ainda nao chegou (`rootTeamId` null), ou
 *   - a tarefa nao tem time resolvido.
 * Os tres casos sao "nao sei o bastante pra esconder ninguem". Errar pro lado
 * de oferecer demais devolve o comportamento de hoje, com a trava do backend
 * ainda de pe; errar pro lado de esconder demais tira gente do trabalho sem
 * explicar por que.
 */
export function foraDoEscopo(
  subtimePorMembro: Map<string, string | null>,
  taskTeamId: string | null | undefined,
  rootTeamId: string | null
): Set<string> {
  const fora = new Set<string>();
  if (!taskTeamId || rootTeamId === null) return fora;
  if (taskTeamId === rootTeamId) return fora;
  for (const [id, subtime] of subtimePorMembro) {
    if (subtime !== taskTeamId) fora.add(id);
  }
  return fora;
}

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
