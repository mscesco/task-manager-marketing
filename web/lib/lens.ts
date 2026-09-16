// Lente de time do usuario (Trabalho 2, Fatia 2).
//
// Compoe o `teams` do /me (vinculos time+papel) com a arvore de times
// (listTeams, que traz parent_team_id) para responder as tres perguntas
// que as fatias seguintes fazem:
//   - qual e a raiz (o Quadro Geral);
//   - quais quadros de time eu vejo (as sub-abas do menu);
//   - para cada time, se enxergo descendentes (manager/admin) ou so
//     ele + a raiz (operador/supervisor).
//
// Espelha a regra do backend (team_scope.visible_team_ids):
//   MANAGER/ADMIN de T: T + descendentes.
//   SUPERVISOR/OPERATOR de X: X + raiz.
// NAO chama a API -- recebe os dados ja carregados por parametro, para ser
// pura e testavel isolada.

import type { Team, TeamMembership } from "@/lib/api";
import { rootTeamOf } from "@/lib/areas";

// Papeis que enxergam os descendentes (espelha _MANAGING_ROLES no backend).
const MANAGING_ROLES = new Set(["MANAGER", "ADMIN"]);

// Papeis que veem TODOS os times, sem vinculo (Spec 051, fatia F -- ver
// `computeLens`). Espelha `ORG_ROLES` do `team_scope`.
const ROLES_QUE_VEEM_TUDO = ["ADMIN", "GESTOR"] as const;

export type TeamLens = {
  /** Id do time raiz (parent_team_id === null). null se nao houver. */
  rootId: string | null;
  /** Ids de TODOS os times cujas tasks o usuario enxerga (raiz + subtimes). */
  visibleTeamIds: Set<string>;
  /**
   * Times de SUBTIME (nao-raiz) que viram sub-aba de quadro para este
   * usuario, ja ordenados por nome. Um manager/admin ve os descendentes;
   * um operador ve so o(s) subtime(s) em que esta.
   */
  boardSubteams: Team[];
};

/** Filhos diretos de um time na arvore. */
function childrenOf(teamId: string, teams: Team[]): Team[] {
  return teams.filter((t) => t.parent_team_id === teamId);
}

/** teamId + todos os descendentes (BFS, protegido contra ciclo). */
function withDescendants(teamId: string, teams: Team[]): Set<string> {
  const out = new Set<string>([teamId]);
  const fila = [teamId];
  let guard = 0;
  while (fila.length && guard < 1000) {
    guard += 1;
    const atual = fila.shift() as string;
    for (const c of childrenOf(atual, teams)) {
      if (!out.has(c.id)) {
        out.add(c.id);
        fila.push(c.id);
      }
    }
  }
  return out;
}

/**
 * Deriva a lente a partir dos vinculos do usuario (/me.teams), da arvore de
 * times (listTeams) e dos PAPEIS dele (/me.roles). Pura: nao bate na API.
 *
 * ⚠️⚠️ O `roles` NASCEU DE UM DEFEITO EM PRODUCAO, em 09/09/2026, e vale
 * saber qual: a conta de administracao da Camila ficou SEM VINCULO DE TIME
 * NENHUM (passo 2 da Spec 045, fatia B) e o menu parou de mostrar os quadros
 * dos subtimes. Ela abriu, viu so o "Quadro geral" e estranhou.
 *
 * A causa: esta funcao derivava tudo de `myTeams`. Sem vinculos, o laco
 * abaixo nao roda nenhuma vez, `visible` fica vazio e `boardSubteams` tambem.
 *
 * ⚠️ E O `/auth/me` DIZIA QUE ISSO NAO IA ACONTECER. O comentario da rota
 * afirmava: *"Assim a fatia B nao exige mudanca nenhuma no front."* Era
 * verdade para `permissoesMembros.alcanceDe`, que le `permissions` -- e falso
 * para esta funcao, que ninguem conferiu. O papel de organizacao SEMPRE
 * esteve em `me.roles`; o que faltava era alguem olhar.
 *
 * ⚠️ NAO DA PARA DERIVAR ISTO DE `permissions`. Um MANAGER tambem tem
 * `team.manage`, e tratar isso como "ve tudo" quebraria o escopo dele com N
 * areas -- ele passaria a ver os subtimes do TI. O papel e a pergunta certa.
 *
 * ⚠️⚠️ ADMIN **E GESTOR** DESDE A SPEC 051 (fatia F). Ate ali esta linha era
 * so `ADMIN`, com o argumento de espelhar `team_scope.is_admin` -- e o
 * argumento caducou na Spec 049 (fatia 0b): o backend passou a abrir a lente
 * para TODO papel de organizacao (`visible_team_ids`, *"gestor ve tudo"*,
 * decisao da Spec 045). A tela ficou para tras, e um GESTOR sem vinculo de time
 * abria o quadro e lia "Voce nao tem acesso ao quadro deste time" sobre um
 * quadro que o servidor lhe entregava.
 *
 * ⚠️ `ADMIN` continua cobrindo os dois niveis: o papel de organizacao e o
 * vinculo ADMIN antigo de time chegam iguais em `roles`.
 */
export function computeLens(
  myTeams: TeamMembership[],
  allTeams: Team[],
  roles: readonly string[],
  activeRootId: string | null
): TeamLens {
  // ⚠️⚠️ A RAIZ VEM DE FORA, e ate 11/09 esta linha era
  // `allTeams.find((t) => t.parent_team_id === null)` -- A PRIMEIRA RAIZ QUE
  // APARECESSE. Com duas, a ordem e a que a API devolver, e o menu passou a
  // responder pelo time errado: a Camila viu o Comercial vazio estando no
  // Marketing. E o defeito 3.2 da Spec 048.
  //
  // ⚠️ SEM DEFAULT, de proposito -- mesmo argumento que a Spec 046 (fatia 4)
  // usou em `default_board_and_column_for_status`: um
  // `activeRootId: string | null = null` deixaria os dois chamadores
  // compilando e continuando errados em silencio. Sem default, o `tsc` aponta
  // os dois.
  const rootId = activeRootId;

  // Papel de ORGANIZACAO (ADMIN ou GESTOR) -- e o vinculo ADMIN antigo de time
  // -- enxerga a arvore inteira: espelha `visible_team_ids` devolvendo `None`.
  if (ROLES_QUE_VEEM_TUDO.some((r) => roles.includes(r))) {
    return {
      rootId,
      visibleTeamIds: new Set(allTeams.map((t) => t.id)),
      boardSubteams: subteamsOf(activeRootId, allTeams),
    };
  }

  const visible = new Set<string>();
  for (const m of myTeams) {
    if (MANAGING_ROLES.has(m.role)) {
      for (const id of withDescendants(m.team_id, allTeams)) visible.add(id);
    } else {
      visible.add(m.team_id);
      const r = rootTeamOf(m.team_id, allTeams);
      if (r) visible.add(r);
    }
  }

  // Sub-abas = subtimes DO TIME ATIVO que a lente alcanca.
  //
  // ⚠️⚠️ O RECORTE POR TIME E NOVO (11/09). Antes eram os subtimes visiveis de
  // QUALQUER time, e para um ADMIN isso era a arvore inteira: o menu listava os
  // subtimes do Comercial e do Marketing juntos, sem dizer de quem era cada um.
  const boardSubteams = subteamsOf(activeRootId, allTeams).filter((t) =>
    visible.has(t.id)
  );

  return { rootId, visibleTeamIds: visible, boardSubteams };
}

/**
 * Os subtimes -- diretos e indiretos -- do time raiz `rootId`.
 *
 * ⚠️ `null` devolve VAZIO, e nao "todos". Sem time ativo nao ha sub-aba a
 * mostrar, e o menu com a arvore inteira e exatamente o defeito que o recorte
 * veio matar. Falha fechada.
 *
 * ⚠️ Ordenado por nome, pelo mesmo motivo de `rootTeams`: a ordem da API nao e
 * contrato, e uma lista de menu que troca de ordem entre dois carregamentos le
 * como se o produto tivesse mexido em algo.
 */
function subteamsOf(rootId: string | null, allTeams: Team[]): Team[] {
  if (rootId === null) return [];
  return allTeams
    .filter(
      (t) => t.parent_team_id !== null && rootTeamOf(t.id, allTeams) === rootId
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
