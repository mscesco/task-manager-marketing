// Lente de time do usuário: raiz, times visíveis e sub-abas de quadro.
// Espelha `team_scope.visible_team_ids`: MANAGER de T vê T + descendentes;
// SUPERVISOR/OPERATOR de X vê X + raiz. Pura, sem API.

import type { Team, TeamMembership } from "@/lib/api";
import { rootTeamOf } from "@/lib/rootTeams";

// Papeis que enxergam os descendentes (espelha _MANAGING_ROLES no backend).
const MANAGING_ROLES = new Set(["MANAGER"]);

// Papéis de organização veem todos os times, sem vínculo (espelha `ORG_ROLES`).
const ROLES_QUE_VEEM_TUDO = ["ADMIN", "GESTOR"] as const;

export type TeamLens = {
  /** Id do time raiz (parent_team_id === null). null se nao houver. */
  rootId: string | null;
  /** Ids dos times cujas tasks o usuario enxerga (raiz + subtimes). */
  visibleTeamIds: Set<string>;
  /** Subtimes que viram sub-aba de quadro para este usuario, por nome. */
  boardSubteams: Team[];
};

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
 * Deriva a lente dos vínculos, da árvore e dos papéis. Papel de organização
 * vem de `roles`, não de `permissions`: MANAGER também tem `team.manage` e não vê tudo.
 */
export function computeLens(
  myTeams: TeamMembership[],
  allTeams: Team[],
  roles: readonly string[],
  activeRootId: string | null
): TeamLens {
  const rootId = activeRootId;

  // Papel de organização (e o vínculo ADMIN antigo) enxerga a árvore inteira.
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

  // Sub-abas = subtimes do time ativo que a lente alcança.
  const boardSubteams = subteamsOf(activeRootId, allTeams).filter((t) =>
    visible.has(t.id)
  );

  return { rootId, visibleTeamIds: visible, boardSubteams };
}

/** Subtimes (diretos e indiretos) do time raiz, por nome. `null` devolve vazio, não todos. */
function subteamsOf(rootId: string | null, allTeams: Team[]): Team[] {
  if (rootId === null) return [];
  return allTeams
    .filter(
      (t) => t.parent_team_id !== null && rootTeamOf(t.id, allTeams) === rootId
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
