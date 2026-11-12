// Linhas do painel do membro: o cargo mora no vínculo (um por time), não na pessoa.

import type { MemberRole, MemberTeamComCadeado, Team } from "./api";
import { rootTeamOf } from "./rootTeams";

/** Uma linha do painel: um vínculo, e o que dá para fazer com ele. */
export type DrawerMembership = {
  readonly team: Team;
  readonly role: MemberRole;
  /** Vem do backend; a tela não recalcula. */
  readonly podeEditarCargo: boolean;
  /** Raiz onde a pessoa tem comando: aí a linha do subtime é alocação, não cargo escolhível. */
  readonly autoridadeVemDe: Team | null;
  /** É time raiz? Vai para `papeisAtribuiveis`. */
  readonly isRoot: boolean;
};

// Quais papéis oferecer não se decide aqui: é `permissoesMembros.papeisAtribuiveis`.

const COMANDO: MemberRole[] = ["MANAGER"];

/** Linhas do painel. Mostra todos os vínculos, inclusive em times que quem olha não administra. */
export function drawerMemberships(
  memberships: readonly MemberTeamComCadeado[],
  teams: readonly Team[],
): DrawerMembership[] {
  const porId = new Map(teams.map((t) => [t.id, t]));

  return memberships
    .map((v): DrawerMembership | null => {
      const team = porId.get(v.team_id);
      if (!team) return null;

      const isRoot = team.parent_team_id === null;
      const raiz = isRoot ? team : raizDe(team, teams);
      // Comando na raiz DAQUELA árvore, vindo de outro vínculo da pessoa.
      const comandoNaRaiz =
        !isRoot && raiz
          ? memberships.find(
              (o) => o.team_id === raiz.id && COMANDO.includes(o.role),
            )
          : undefined;

      return {
        team,
        role: v.role,
        podeEditarCargo: v.can_edit_role,
        autoridadeVemDe: comandoNaRaiz && raiz ? raiz : null,
        isRoot,
      };
    })
    .filter((l): l is DrawerMembership => l !== null)
    .sort((a, b) => {
      // Time raiz primeiro, depois subtimes por nome.
      const ra = a.team.parent_team_id === null ? 0 : 1;
      const rb = b.team.parent_team_id === null ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.team.name.localeCompare(b.team.name, "pt-BR");
    });
}

/** A raiz do time, pela regra de `lib/rootTeams`. */
function raizDe(team: Team, teams: readonly Team[]): Team | null {
  const id = rootTeamOf(team.id, teams);
  return teams.find((t) => t.id === id) ?? null;
}

/** O que muda quando alguém recebe este cargo, numa frase que nomeia o time. */
export function roleConsequence(
  role: MemberRole,
  nomeDoTime: string,
): string {
  switch (role) {
    case "MANAGER":
      return `Manda em ${nomeDoTime} e em todos os subtimes dele: administra as pessoas, monta os quadros e tria as solicitações.`;
    case "SUPERVISOR":
      return `Administra os operadores de ${nomeDoTime} e monta o quadro de ${nomeDoTime}.`;
    case "OPERATOR":
      return `Trabalha em ${nomeDoTime}: cria e toca tarefas, sem mexer na estrutura.`;
  }
}
