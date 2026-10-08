// lib/alcance.ts
// O ALCANCE de uma gestao: onde o ator pode agir. Era escrito duas vezes,
// com o mesmo corpo -- para membros (`lib/permissoesMembros.ts`) e para
// quadros (`lib/seletorDeQuadro.ts`) -- trocando so os dois verbos
// (revisao de 07/10).

import type { Permission } from "./permissions.generated";

export type Alcance =
  /** Tem o verbo AMPLO: alcanca qualquer time. */
  | { readonly tipo: "amplo" }
  /**
   * Tem so o verbo de SUBTIME: alcanca os subtimes onde ELE e supervisor. A
   * lista importa -- sem ela, o mapa de permissao sozinho deixaria qualquer
   * supervisor agir no subtime de qualquer outro.
   */
  | { readonly tipo: "subtime"; readonly subtimes: readonly string[] }
  /** Nenhum dos dois: a tela vira somente leitura. */
  | { readonly tipo: "nenhum" };

/** So o que precisamos do usuario autenticado -- facilita testar. */
export type AtorMinimo = {
  permissions: Permission[];
  teams: { team_id: string; role: string }[];
};

/**
 * Deriva o alcance do `/auth/me`.
 *
 * ⚠️ O AMPLO GANHA. Quem tem os dois verbos -- ADMIN e MANAGER tem, porque o
 * mapa de permissoes e uniao de papeis -- fica com o alcance maior. Testar so
 * o supervisor deixaria esta ordem invertida passar.
 */
export function alcancePor(
  me: AtorMinimo | null | undefined,
  amplo: Permission,
  deSubtime: Permission,
): Alcance {
  if (!me) return { tipo: "nenhum" };
  if (me.permissions.includes(amplo)) return { tipo: "amplo" };
  if (me.permissions.includes(deSubtime)) {
    return {
      tipo: "subtime",
      subtimes: me.teams.filter((t) => t.role === "SUPERVISOR").map((t) => t.team_id),
    };
  }
  return { tipo: "nenhum" };
}
