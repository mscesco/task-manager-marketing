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

/**
 * As DUAS respostas que o quadro deve dar ao modal de criar.
 *
 * ⚠️⚠️ UM OBJETO, E NAO DUAS PROPS. Ate 11/09 isto era uma prop so --
 * `defaultTeamId` -- carregando dois significados de uma vez:
 *
 *   1. QUAL time a tarefa nova recebe (escopo: quem pode ser responsavel);
 *   2. se a tarefa nasce DENTRO de um quadro proprio, o que esconde o
 *      seletor de projeto.
 *
 * Enquanto os dois andavam juntos ninguem viu. O quadro geral da RAIZ e o
 * caso em que eles se separam: a tarefa tem time (a raiz), mas nao nasce
 * interna a nada -- e o seletor de projeto tem de aparecer. Com uma prop so,
 * responder (1) corretamente apagava o seletor de projeto da tela.
 *
 * Passar as duas como props separadas deixaria possivel preencher METADE da
 * decisao. Um objeto, ou `null` para "esta tela nao cria tarefa", nao deixa.
 */
export type NewTaskTeam = {
  /** Time que a tarefa nova recebe. `null` = raiz ainda desconhecida. */
  teamId: string | null;
  /** A tarefa nasce dentro de um quadro proprio (subtime ou quadro avulso). */
  internal: boolean;
};

/**
 * O time da tarefa nova, decidido pelo QUADRO que esta aberto.
 *
 * ⚠️⚠️ A LINHA `?? rootId` E O CONSERTO DE 11/09, reportado na tela: no quadro
 * geral de um time RAIZ o seletor de responsavel oferecia a organizacao
 * inteira, gente de outro time raiz incluida.
 *
 * A cadeia era esta: o quadro devolvia `null` (nao ha quadro avulso nem
 * subtime), o modal caia no `getRootTeamId()` dele proprio, e essa funcao
 * LEVANTA desde a Spec 046 quando existe mais de uma raiz. Sem raiz, sem
 * `?reaches_team=`, sem filtro -- e a lista voltava a ser "todo mundo", que e
 * exatamente o comportamento que a Spec 034 tirou.
 *
 * ⚠️ E NAO ERA SO O SELETOR: `createTask` tambem chama `getRootTeamId()` para
 * pinar a tarefa quando ninguem manda `team_id`. Levantando ali, a criacao
 * falhava no Salvar. A raiz que a tela JA CONHECE (ela veio na URL, Spec 046
 * fatia 4) responde as duas.
 *
 * `boardId` continua mandando mais que `subteamId` -- mesma precedencia de
 * sempre, agora com teste.
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
    // ⚠️ `doQuadro`, e NAO `teamId`: a raiz vinda do `??` nao torna a tarefa
    // interna. Ler `teamId` aqui e o defeito que este objeto existe pra matar.
    internal: doQuadro !== null,
  };
}
