// Em que time a tela está. Mora na URL: no caminho nas telas DO time
// (`/times/<id>`, `/quadro/<id>`), em `?time=<id>` nas telas recortadas.
// Recebe a query como string: `useSearchParams` em rota estática derruba o build.

import type { Team } from "./api";
import { rootTeamOf } from "./rootTeams";

/** O nome do parâmetro na URL. */
export const TEAM_PARAM = "time";

/** "Todos os times" -- só Minhas tarefas oferece. */
export const ALL_TEAMS = "tudo";

/** As rotas que carregam o time no caminho. */
const ROTAS_COM_TIME = ["/times/", "/quadro/"] as const;

/**
 * Telas recortadas via `?time=`. Lista explícita: uma tela só entra quando lê
 * o parâmetro, senão a URL diz um time e não filtra nada.
 */
export const TEAM_PARAM_SCREENS = [
  "/inicio",
  "/minhas-tarefas",
  "/projetos",
  "/arquivadas",
  "/solicitacoes",
  "/formularios",
] as const;

/** Em que time a tela está. `fromUrl: false` manda a tela reescrever a URL (`replace`). */
export type ActiveTeam =
  /** Um time resolvido. `fromUrl` diz se ele veio de lá ou foi inferido. */
  | { readonly kind: "team"; readonly teamId: string; readonly fromUrl: boolean }
  /** A pessoa pediu todos — só Minhas tarefas oferece. */
  | { readonly kind: "all" }
  /** Sem time na URL e sem vínculo: não há o que recortar. */
  | { readonly kind: "none" };

/**
 * Resolve o time ativo, nesta ordem:
 *   1. o time no caminho, subindo até a raiz (não validado: quem recusa é a tela/servidor);
 *   2. `?time=tudo`;
 *   3. `?time=<id>`, subindo até a raiz, se a pessoa alcança;
 *   4. reserva: `preferredTeams(reachable, own)[0]`, como inferido;
 *   5. nada.
 */
export function activeTeam(
  pathname: string,
  search: string,
  teams: readonly Team[],
  reachable: readonly Team[],
  own: readonly Team[],
): ActiveTeam {
  const doCaminho = teamInPath(pathname, teams);
  if (doCaminho !== null) {
    return { kind: "team", teamId: doCaminho, fromUrl: true };
  }

  // `URLSearchParams` aceita com e sem "?".
  const pedido = new URLSearchParams(search).get(TEAM_PARAM);
  if (pedido === ALL_TEAMS) return { kind: "all" };
  // Projeto pode ser de subtime: o parâmetro sobe até a raiz. `fromUrl` só é
  // true se a URL já dizia a raiz; senão `teamUrlToWrite` reescreve.
  const raizDoPedido = pedido !== null ? rootTeamOf(pedido, teams) : null;
  if (raizDoPedido !== null && reachable.some((t) => t.id === raizDoPedido)) {
    return { kind: "team", teamId: raizDoPedido, fromUrl: pedido === raizDoPedido };
  }

  const reserva = preferredTeams(reachable, own)[0];
  if (!reserva) return { kind: "none" };
  return { kind: "team", teamId: reserva.id, fromUrl: false };
}

/**
 * Ordem de preferência dos times da pessoa: onde ela trabalha (`own`) e depois
 * o resto que ela alcança. Regra única para a reserva, o menu e a entrada do quadro.
 */
export function preferredTeams(
  reachable: readonly Team[],
  own: readonly Team[],
): Team[] {
  const idsProprios = new Set(own.map((t) => t.id));
  return [...own, ...reachable.filter((t) => !idsProprios.has(t.id))];
}

/** O time no caminho, resolvido até a raiz; `split` para aceitar `/times/<id>/algo`. */
function teamInPath(pathname: string, teams: readonly Team[]): string | null {
  const prefixo = ROTAS_COM_TIME.find((p) => pathname.startsWith(p));
  if (!prefixo) return null;
  const id = pathname.slice(prefixo.length).split("/")[0];
  if (!id) return null;
  // Time desconhecido devolve `null` e cai na reserva.
  return rootTeamOf(id, teams);
}

/**
 * A mesma URL com outro time, preservando os outros parâmetros. Não serve para
 * rotas com time no caminho (o caminho ganha do parâmetro).
 */
export function withTeam(
  pathname: string,
  search: string,
  value: string,
): string {
  const params = new URLSearchParams(search);
  params.set(TEAM_PARAM, value);
  return `${pathname}?${params.toString()}`;
}

/**
 * O time ativo que a barra publica, ou `null` ("ainda não sei") enquanto a
 * árvore ou a query não chegaram -- antes disso `activeTeam` responde errado e
 * as telas buscariam sem recorte. `teamsLoaded`, não `teams.length`: a árvore
 * pode falhar e ficar vazia.
 */
export function publishedActiveTeam(
  resolved: ActiveTeam,
  teamsLoaded: boolean,
  search: string | null,
): ActiveTeam | null {
  if (!teamsLoaded || search === null) return null;
  return resolved;
}

/**
 * A URL que a tela reescreve (com `replace`) para mostrar o time inferido, ou
 * `null` se a tela não lê o parâmetro, a URL já dizia ou não há time.
 * `search === null` = query ainda não lida: não reescrever por cima de um `?time=`.
 */
export function teamUrlToWrite(
  pathname: string,
  active: ActiveTeam,
  search: string | null,
): string | null {
  if (search === null) return null;
  if (!(TEAM_PARAM_SCREENS as readonly string[]).includes(pathname)) return null;
  if (active.kind !== "team" || active.fromUrl) return null;
  return withTeam(pathname, search, active.teamId);
}

/**
 * Endereço de um item do menu levando o time ativo (só `kind: "team"` e só nas
 * telas de `TEAM_PARAM_SCREENS`); senão o caminho puro. Outros parâmetros não vão.
 */
export function navHref(pathname: string, active: ActiveTeam | null): string {
  if (!(TEAM_PARAM_SCREENS as readonly string[]).includes(pathname)) return pathname;
  if (active === null || active.kind !== "team") return pathname;
  return withTeam(pathname, "", active.teamId);
}
