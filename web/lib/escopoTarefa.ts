// Time da tarefa nova, lado do front. Quem pode ser responsável vem do
// backend (`listMembers(taskId)` / `listMembersDoTime(teamId)`); não
// reconstrua aqui a regra de alcance.

/**
 * Time que a tarefa nova vai ter, decidido antes do POST. Espelha o pin do
 * `createTask` (`lib/api.ts`): se mudar lá, mude aqui.
 */
export function timeDaTarefaNova(
  defaultTeamId: string | null | undefined,
  rootTeamId: string | null
): string | null {
  return defaultTeamId ?? rootTeamId;
}

/**
 * O que o quadro diz ao modal de criar. Um objeto só porque as duas respostas
 * se separam no quadro geral da raiz: a tarefa tem time, mas não é interna, e
 * o seletor de projeto aparece.
 */
export type NewTaskTeam = {
  /** Time que a tarefa nova recebe. `null` = raiz ainda desconhecida. */
  teamId: string | null;
  /** A tarefa nasce dentro de um quadro proprio (subtime ou quadro avulso). */
  internal: boolean;
};

/**
 * O time da tarefa nova, pelo quadro aberto. Sem quadro avulso nem subtime,
 * cai na raiz da URL: sem ela o seletor ofereceria a organização inteira e o
 * `createTask` não saberia onde pinar. `boardId` manda mais que `subteamId`.
 */
export function newTaskTeam(args: {
  /** Quadro avulso aberto. `null` = quadro geral. */
  boardId: string | null;
  /** Time do quadro avulso. `null` = ainda nao chegou da rede. */
  boardTeamId: string | null;
  /** Quadro de subtime. */
  subteamId: string | null;
  /** A raiz que a tela recebeu pela URL. `null` = desconhecida. */
  rootId: string | null;
}): NewTaskTeam {
  const doQuadro = args.boardId ? args.boardTeamId : args.subteamId;
  return {
    teamId: doQuadro ?? args.rootId,
    // `doQuadro`, não `teamId`: a raiz vinda do `??` não torna a tarefa interna.
    internal: doQuadro !== null,
  };
}
