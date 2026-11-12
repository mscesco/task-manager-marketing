// Lógica pura da tela `/organizacao`: cartões dos times raiz, pessoas sem time, busca de pessoa.

import type { Member, OrgRole, Team } from "./api";
import type { Permission } from "./permissions.generated";

/** Um cartão da grade de times raiz. */
export type RootTeamCard = {
  readonly root: Team;
  /** Pessoas ATIVAS com vínculo no time OU em qualquer subtime dele. */
  readonly pessoas: number;
  /** Subtimes -- diretos e indiretos. */
  readonly subteams: number;
};

/**
 * A grade de times raiz. A contagem usa `member.root_team_ids` (já
 * deduplicado no backend): somar os membros de cada time da árvore contaria
 * duas vezes quem está no time e num subtime. Só ativos, como `subteamCards`.
 */
export function rootTeamCards(
  teams: readonly Team[],
  members: readonly Member[],
): RootTeamCard[] {
  const roots = teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return roots.map((root) => ({
    root,
    pessoas: members.filter(
      (m) => m.is_active && (m.root_team_ids ?? []).includes(root.id),
    ).length,
    subteams: descendentes(root.id, teams).size,
  }));
}

/** Subtimes de um time raiz -- diretos E indiretos (a árvore tem três níveis). */
function descendentes(rootId: string, teams: readonly Team[]): Set<string> {
  const out = new Set<string>();
  const fila = [rootId];
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
 * Quem não está em time nenhum; sem este cartão essa pessoa não aparece em
 * lugar nenhum. Usa `root_team_ids`, não `team_ids` (que só traz subtimes).
 */
export function peopleWithoutRoot(members: readonly Member[]): Member[] {
  return members
    .filter((m) => (m.root_team_ids ?? []).length === 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Quem pode abrir `/organizacao`: papel de organização. `null`/`undefined` (carregando) é "não". */
export function podeAbrirOrganizacao(
  me: { org_role?: OrgRole | null } | null | undefined,
): boolean {
  return (me?.org_role ?? null) !== null;
}

/** Quem administra a organização, ADMIN primeiro -- vai no cabeçalho. */
export function organizationManagers(members: readonly Member[]): Member[] {
  return members
    .filter((m) => m.org_role != null)
    .sort((a, b) => {
      if (a.org_role !== b.org_role) return a.org_role === "ADMIN" ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

/** Só o que a regra abaixo precisa de quem está olhando. */
export type AtorDeOrganizacao = {
  org_role?: OrgRole | null;
  permissions: readonly Permission[];
};

/**
 * Papéis de organização que o ator pode dar a esta pessoa (`null` na lista =
 * tirar da administração), ou `null` se ele não mexe nela. GESTOR não oferece
 * ADMIN nem mexe em ADMIN. Só decide o que desenhar; o servidor confere.
 */
export function papeisDeOrganizacaoAtribuiveis(
  ator: AtorDeOrganizacao,
  papelDoAlvo: OrgRole | null,
): readonly (OrgRole | null)[] | null {
  if (!ator.permissions.includes("org_role.grant")) return null;
  if (ator.org_role === "ADMIN") return ["ADMIN", "GESTOR", null];
  if (papelDoAlvo === "ADMIN") return null;
  return ["GESTOR", null];
}

/** Uma pessoa achada pela busca, com os times raiz em que ela está. */
export type FoundPerson = {
  readonly member: Member;
  readonly roots: Team[];
};

/** Busca de pessoa atravessando os times raiz (nome ou e-mail, sem acento e sem caixa). */
export function searchPeople(
  term: string,
  members: readonly Member[],
  teams: readonly Team[],
): FoundPerson[] {
  if (normalizeText(term) === "") return [];
  return members
    .filter((m) => matchesSearch(term, m))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((member) => ({
      member,
      roots: (member.root_team_ids ?? [])
        .map((id) => teams.find((t) => t.id === id))
        .filter((t): t is Team => t !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    }));
}

/** A pessoa casa com o termo? Regra única das duas telas de pessoas. */
export function matchesSearch(term: string, member: Member): boolean {
  const alvo = normalizeText(term);
  if (alvo === "") return true;
  return (
    normalizeText(member.name).includes(alvo) ||
    normalizeText(member.email).includes(alvo)
  );
}

/** Minúscula e sem acento; precisa concordar com o `unaccent` da busca do backend. */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
