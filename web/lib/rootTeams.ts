// Resolve o time raiz (time sem pai): lista, sobe a árvore e decide a entrada do quadro.

import type { Team } from "./api";

/** "nenhuma" = workspace sem raiz (ou lista não carregada); "varias" = a tela precisa dizer qual. */
export type RootTeamUndefinedReason = "nenhuma" | "varias";

export class RootTeamUndefinedError extends Error {
  readonly motivo: RootTeamUndefinedReason;
  /** Ids das raízes encontradas; vazio quando `motivo` é "nenhuma". */
  readonly rootIds: readonly string[];

  constructor(motivo: RootTeamUndefinedReason, rootIds: readonly string[]) {
    super(
      motivo === "nenhuma"
        ? "Não consegui identificar o time: este workspace não tem nenhum time principal."
        : "Este workspace tem mais de um time, e esta tela ainda não pergunta qual.",
    );
    this.name = "RootTeamUndefinedError";
    this.motivo = motivo;
    this.rootIds = rootIds;
  }
}

/** Times sem pai, ordenados por nome: a ordem da API não é estável. */
export function rootTeams(teams: readonly Team[]): Team[] {
  return teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Teto de saltos ao subir a árvore. Ela tem três níveis; 50 é folga. */
const MAX_SALTOS = 50;

/**
 * O time raiz acima de `teamId`. Devolve `null` se um ancestral não está na
 * lista (nunca afirma que um subtime é raiz). O teto de saltos protege de ciclo.
 */
export function rootTeamOf(
  teamId: string,
  teams: readonly Team[],
): string | null {
  const byId = new Map(teams.map((t) => [t.id, t]));
  let atual = byId.get(teamId);
  let saltos = 0;
  while (atual && atual.parent_team_id !== null && saltos < MAX_SALTOS) {
    saltos += 1;
    atual = byId.get(atual.parent_team_id);
  }
  return atual ? atual.id : null;
}

/** A única raiz do workspace. Levanta em vez de escolher quando há zero ou várias. */
export function soleRootTeam(teams: readonly Team[]): Team {
  const raizes = rootTeams(teams);
  if (raizes.length === 0) throw new RootTeamUndefinedError("nenhuma", []);
  if (raizes.length > 1) {
    throw new RootTeamUndefinedError(
      "varias",
      raizes.map((t) => t.id),
    );
  }
  return raizes[0];
}

/** Endereço do quadro geral de um time raiz. */
export function rootBoardUrl(rootId: string): string {
  return `/quadro/${rootId}`;
}

/**
 * O que `/quadro` (sem time na URL) faz. Recebe os times da pessoa em ordem de
 * preferência e respeita essa ordem; filtra raiz porque o tipo não garante.
 */
export type EntradaDoQuadro =
  | { readonly tipo: "desenhar"; readonly rootId: string }
  | { readonly tipo: "redirecionar"; readonly para: string }
  | { readonly tipo: "sem-raiz" };

export function entradaDoQuadro(
  myRoots: readonly Team[]
): EntradaDoQuadro {
  const roots = myRoots.filter((t) => t.parent_team_id === null);
  if (roots.length === 0) return { tipo: "sem-raiz" };
  if (roots.length === 1) return { tipo: "desenhar", rootId: roots[0].id };
  return { tipo: "redirecionar", para: rootBoardUrl(roots[0].id) };
}
