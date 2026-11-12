"use client";
// O time ativo, resolvido pelo `AppShell` (que já tem a árvore e o `getMe`) e
// entregue às telas por contexto. `active === null` = "ainda não sei": a tela
// deve esperar, não buscar sem recorte.

import { createContext, useContext } from "react";

import type { ActiveTeam } from "./activeTeam";
import type { Team } from "./api";

/**
 * O que a barra publica. `search` é a query inteira, para links que preservam
 * os outros parâmetros; `null` = ainda não lida.
 */
export type ActiveTeamContext = {
  readonly active: ActiveTeam | null;
  readonly search: string | null;
  /** Nome do time ativo, para a tela dizer pelo que recortou. `null` até a árvore chegar. */
  readonly teamName: string | null;
  /** Times raiz que a pessoa pode escolher, em ordem de preferência (seletor de Minhas tarefas). */
  readonly teams: readonly Team[];
};

const Ctx = createContext<ActiveTeamContext>({
  active: null,
  search: null,
  teamName: null,
  teams: [],
});

export const ActiveTeamProvider = Ctx.Provider;

/** O time ativo desta tela. Fora do `AppShell` devolve `{active: null}`. */
export function useActiveTeam(): ActiveTeamContext {
  return useContext(Ctx);
}

/**
 * O id do time ativo, ou `null`. `kind: "all"` também vira `null`: quem precisa
 * distinguir "todos" de "ainda não sei" usa `useActiveTeam()`.
 */
export function useActiveTeamId(): string | null {
  const { active } = useActiveTeam();
  return active?.kind === "team" ? active.teamId : null;
}
