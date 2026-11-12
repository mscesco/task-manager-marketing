// Lógica pura da tela `/times/[id]`: linhas da tabela, cartões de subtime, gaveta.
// A tabela mostra; o lápis define em quais subtimes; o painel define o cargo em cada um.

import type { Member, MemberRole, Team } from "./api";
import { rootTeamOf } from "./rootTeams";

/** Uma cápsula da coluna de subteams: onde a pessoa está, e como. */
export type SubteamChip = {
  readonly team: Team;
  readonly role: MemberRole;
};

/** Uma linha da tabela. */
export type TeamRow = {
  readonly member: Member;
  /** Cargo no próprio time desta tela, se houver vínculo direto. */
  readonly cargoAqui: MemberRole | null;
  /** Subtimes desta árvore em que a pessoa está, com o cargo. */
  readonly subteams: SubteamChip[];
  /** Quantos outros times raiz a pessoa tem; vira o aviso `+N time`. */
  readonly otherRoots: number;
};

/** O time + todos os descendentes dele. */
export function teamTree(teamId: string, teams: readonly Team[]): Set<string> {
  const out = new Set<string>([teamId]);
  const fila = [teamId];
  let guarda = 0;
  while (fila.length && guarda < 1000) {
    guarda += 1;
    const atual = fila.shift() as string;
    for (const t of teams) {
      if (t.parent_team_id === atual && !out.has(t.id)) {
        out.add(t.id);
        fila.push(t.id);
      }
    }
  }
  return out;
}

/**
 * Linhas da tabela: quem tem vínculo neste time ou em qualquer subtime dele
 * (senão quem está só num subtime some). Inclui inativos: o cabeçalho conta o corpo.
 */
export function teamRows(
  teamId: string,
  teams: readonly Team[],
  members: readonly Member[],
): TeamRow[] {
  const arvore = teamTree(teamId, teams);
  const esteTime = teams.find((t) => t.id === teamId);
  const raizDesteTime = esteTime ? raizDe(esteTime, teams) : null;

  return members
    .map((member): TeamRow | null => {
      const vinculos = member.memberships ?? [];
      const naArvore = vinculos.filter((v) => arvore.has(v.team_id));
      if (naArvore.length === 0) return null;

      const aqui = naArvore.find((v) => v.team_id === teamId) ?? null;
      const subteams = naArvore
        .filter((v) => v.team_id !== teamId)
        .map((v) => ({
          team: teams.find((t) => t.id === v.team_id),
          role: v.role,
        }))
        .filter((c): c is SubteamChip => c.team !== undefined)
        .sort((a, b) => a.team.name.localeCompare(b.team.name, "pt-BR"));

      // Só o aviso de que existe vínculo em outro time raiz; o detalhe fica no painel.
      const otherRoots = (member.root_team_ids ?? []).filter(
        (a) => a !== raizDesteTime,
      ).length;

      return { member, cargoAqui: aqui ? aqui.role : null, subteams, otherRoots };
    })
    .filter((l): l is TeamRow => l !== null)
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "pt-BR"));
}

/** A raiz do time; com pai fora da lista, o próprio time. */
function raizDe(team: Team, teams: readonly Team[]): string {
  return rootTeamOf(team.id, teams) ?? team.id;
}

/** Um cartão da visão "Subtimes". */
export type SubteamCard = {
  readonly team: Team;
  /** Pessoas na árvore DELE (ele + os netos). */
  readonly pessoas: number;
  /** Subtimes dentro dele — a árvore tem três níveis. */
  readonly subteams: number;
};

/**
 * Cartões da visão "Subtimes": só filhos diretos (o neto aparece ao entrar no
 * filho). Conta pessoas, não vínculos.
 */
export function subteamCards(
  teamId: string,
  teams: readonly Team[],
  members: readonly Member[],
): SubteamCard[] {
  return teams
    .filter((t) => t.parent_team_id === teamId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((team) => {
      const arvore = teamTree(team.id, teams);
      return {
        team,
        // Só ativos, para concordar com a gaveta (`directMembers`).
        pessoas: members.filter(
          (m) =>
            m.is_active &&
            (m.memberships ?? []).some((v) => arvore.has(v.team_id)),
        ).length,
        // `arvore` inclui o próprio time; os subteams são o resto.
        subteams: arvore.size - 1,
      };
    });
}

/** Uma pessoa com vínculo DIRETO num time, e o cargo dela ali. */
export type DirectMember = {
  readonly member: Member;
  readonly role: MemberRole;
};

/**
 * Quem tem vínculo direto (não na árvore) e está ativo -- a lista da gaveta,
 * de onde se tira alguém. O inativo continua na aba "Inativos" da pessoa.
 */
export function directMembers(
  teamId: string,
  members: readonly Member[],
): DirectMember[] {
  return members
    .filter((m) => m.is_active)
    .map((member): DirectMember | null => {
      const v = (member.memberships ?? []).find((x) => x.team_id === teamId);
      return v ? { member, role: v.role } : null;
    })
    .filter((m): m is DirectMember => m !== null)
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "pt-BR"));
}

/**
 * Candidatos de "adicionar membro" na gaveta: ativos que ainda não estão no
 * time (o banco tem `UNIQUE (user_id, team_id)`). Cadastrar gente nova é outra ação.
 */
export function subteamCandidates(
  teamId: string,
  members: readonly Member[],
): Member[] {
  return members
    .filter((m) => m.is_active)
    .filter((m) => !(m.memberships ?? []).some((v) => v.team_id === teamId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
