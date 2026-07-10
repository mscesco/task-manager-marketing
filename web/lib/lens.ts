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

/** Sobe da folha ate a raiz (parent === null), protegido contra ciclo. */
function rootOf(teamId: string, teams: Team[]): string | null {
  let atual = teams.find((t) => t.id === teamId);
  let guard = 0;
  while (atual && atual.parent_team_id !== null && guard < 1000) {
    guard += 1;
    const pai = teams.find((t) => t.id === atual!.parent_team_id);
    if (!pai) break;
    atual = pai;
  }
  return atual ? atual.id : null;
}

/**
 * Deriva a lente a partir dos vinculos do usuario (/me.teams) e da arvore
 * de times (listTeams). Pura: nao bate na API.
 */
export function computeLens(
  myTeams: TeamMembership[],
  allTeams: Team[]
): TeamLens {
  const root = allTeams.find((t) => t.parent_team_id === null) ?? null;
  const rootId = root ? root.id : null;

  const visible = new Set<string>();
  for (const m of myTeams) {
    if (MANAGING_ROLES.has(m.role)) {
      for (const id of withDescendants(m.team_id, allTeams)) visible.add(id);
    } else {
      visible.add(m.team_id);
      const r = rootOf(m.team_id, allTeams);
      if (r) visible.add(r);
    }
  }

  // Sub-abas = times visiveis que NAO sao a raiz, ordenados por nome.
  const boardSubteams = allTeams
    .filter((t) => t.parent_team_id !== null && visible.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { rootId, visibleTeamIds: visible, boardSubteams };
}
