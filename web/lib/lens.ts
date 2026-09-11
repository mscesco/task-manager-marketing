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
 * ⚠️ SO `ADMIN`, E NAO `GESTOR`: e o espelho exato de `team_scope.is_admin`,
 * que devolve `True` apenas para `org_role == "ADMIN"`. Um GESTOR sem vinculo
 * de time enxergaria vazio -- **no backend tambem**, e por isso nao invento a
 * diferenca aqui: seria a tela mostrando o que o servidor nao entrega.
 * Ninguem e GESTOR hoje ("o papel nasce para a tela da Spec 047 poder
 * atribui-lo"), entao a decisao cabe a ela, com o caso na frente.
 */
export function computeLens(
  myTeams: TeamMembership[],
  allTeams: Team[],
  roles: readonly string[] = []
): TeamLens {
  const root = allTeams.find((t) => t.parent_team_id === null) ?? null;
  const rootId = root ? root.id : null;

  // Admin (de time, legado, OU de organizacao) enxerga a arvore inteira --
  // espelha `visible_team_ids` devolvendo `None` no backend.
  if (roles.includes("ADMIN")) {
    return {
      rootId,
      visibleTeamIds: new Set(allTeams.map((t) => t.id)),
      boardSubteams: allTeams
        .filter((t) => t.parent_team_id !== null)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
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

  // Sub-abas = times visiveis que NAO sao a raiz, ordenados por nome.
  const boardSubteams = allTeams
    .filter((t) => t.parent_team_id !== null && visible.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { rootId, visibleTeamIds: visible, boardSubteams };
}
