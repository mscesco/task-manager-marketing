// Seletor de contexto da barra: só times raiz. Uma raiz e sem papel de
// organização vira rótulo; mais de uma, ou papel de organização, vira seletor.

import type { CurrentUser, Team } from "./api";
import { rootTeams, rootTeamOf, rootBoardUrl } from "./rootTeams";
import { TEAM_PARAM_SCREENS, withTeam, type ActiveTeam } from "./activeTeam";

/**
 * Times raiz que a pessoa alcança: todos para quem administra a organização;
 * senão as raízes dos vínculos dela (vínculo só em subtime conta).
 */
export function rootsForPerson(
  teams: readonly Team[],
  me: CurrentUser | null,
  canManageOrg: boolean,
): Team[] {
  const raizes = rootTeams(teams);
  if (canManageOrg) return raizes;
  if (!me) return [];

  const minhas = new Set<string>();
  for (const vinculo of me.teams) {
    const raiz = rootTeamOf(vinculo.team_id, teams);
    if (raiz) minhas.add(raiz);
  }
  return raizes.filter((t) => minhas.has(t.id));
}

/**
 * Times raiz em que a pessoa trabalha (subconjunto de `rootsForPerson`).
 * Pode ser vazio para quem administra a organização sem vínculo.
 */
export function ownRootTeams(
  teams: readonly Team[],
  me: CurrentUser | null,
): Team[] {
  if (!me) return [];
  const minhas = new Set<string>();
  for (const vinculo of me.teams) {
    const raiz = rootTeamOf(vinculo.team_id, teams);
    if (raiz) minhas.add(raiz);
  }
  return rootTeams(teams).filter((t) => minhas.has(t.id));
}

/**
 * O que o botão da barra mostra e qual item leva o ✓. Num subtime mostra a
 * raiz dele; sem time na URL (`/times/<id>` ou `/quadro/<id>`), o nome da organização.
 */
export type CurrentContext = {
  /** O que o botão mostra. Nunca vazio. */
  readonly label: string;
  /** Qual time raiz leva o ✓ no menu. `null` = nenhum (você está na organização). */
  readonly activeRootId: string | null;
};

/** As telas que carregam um time NA URL, e onde ele está no caminho. */
const ROTAS_COM_TIME = ["/times/", "/quadro/"] as const;

export function currentContext(
  pathname: string,
  teams: readonly Team[],
  orgName: string,
): CurrentContext {
  // Fallback para antes de `getWorkspace()` responder.
  const organizacao = { label: orgName.trim() || "Organização", activeRootId: null };

  const prefixo = ROTAS_COM_TIME.find((p) => pathname.startsWith(p));
  if (!prefixo) return organizacao;

  // `split`, não regex ancorada: `/times/<id>/algo` resolve para o mesmo time.
  const id = pathname.slice(prefixo.length).split("/")[0];
  if (!id) return organizacao;

  const raiz = rootTeamOf(id, teams);
  const time = raiz ? teams.find((t) => t.id === raiz) : undefined;
  // Time desconhecido (lista carregando ou id inválido) cai na organização.
  if (!time) return organizacao;
  return { label: time.name, activeRootId: time.id };
}

/** O que desenhar na barra. */
export type ContextChoice =
  /** Nome do time, sem chevron: não há escolha a fazer. */
  | { readonly kind: "label"; readonly team: Team }
  /** O menu, com os times raiz e (talvez) "Gerenciar a organização". */
  | {
      readonly kind: "switcher";
      readonly roots: readonly Team[];
      readonly canManageOrg: boolean;
    }
  /** Nada a mostrar — sem time e sem poder na organização. */
  | { readonly kind: "none" };

export function contextChoice(
  teams: readonly Team[],
  me: CurrentUser | null,
  canManageOrg: boolean,
): ContextChoice {
  const roots = rootsForPerson(teams, me, canManageOrg);

  // Quem administra a organização sempre vê o seletor: "Gerenciar a organização" só existe nele.
  if (canManageOrg) return { kind: "switcher", roots, canManageOrg: true };

  if (roots.length === 0) return { kind: "none" };
  if (roots.length === 1) return { kind: "label", team: roots[0] };
  return { kind: "switcher", roots, canManageOrg: false };
}

/** Para qual time a entrada de pessoas do menu leva: o primeiro da lista recebida (já ordenada). */
export type PeopleEntry =
  | { readonly kind: "team"; readonly teamId: string }
  | { readonly kind: "none" };

export function peopleEntry(roots: readonly Team[]): PeopleEntry {
  if (roots.length === 0) return { kind: "none" };
  return { kind: "team", teamId: roots[0].id };
}

/**
 * Para onde o seletor leva, preservando a tela: no quadro, o quadro do outro
 * time (o time está no caminho, não em `?time=`); nas telas recortadas, a mesma
 * tela com `withTeam`; nas demais, `/times/<id>`.
 */
export function switcherHref(
  pathname: string,
  search: string,
  teamId: string,
): string {
  if (pathname === "/quadro" || pathname.startsWith("/quadro/")) {
    return rootBoardUrl(teamId);
  }
  if ((TEAM_PARAM_SCREENS as readonly string[]).includes(pathname)) {
    return withTeam(pathname, search, teamId);
  }
  return `/times/${teamId}`;
}

/** Para qual time o item **Time** do menu leva: o time ativo, se houver; senão `peopleEntry`. */
export function peopleEntryFor(
  active: ActiveTeam | null,
  preferred: readonly Team[],
): PeopleEntry {
  if (active !== null && active.kind === "team") {
    return { kind: "team", teamId: active.teamId };
  }
  return peopleEntry(preferred);
}
