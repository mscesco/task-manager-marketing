// Alcance de uma gestao (membros, quadros): onde o ator pode agir.

import type { Permission } from "./permissions.generated";

export type Alcance =
  /** Tem o verbo amplo: alcanca qualquer time. */
  | { readonly tipo: "amplo" }
  /** So o verbo de subtime: alcanca os subtimes onde ele e supervisor. */
  | { readonly tipo: "subtime"; readonly subtimes: readonly string[] }
  /** Nenhum dos dois: a tela vira somente leitura. */
  | { readonly tipo: "nenhum" };

/** So o que precisamos do usuario autenticado. */
export type AtorMinimo = {
  permissions: Permission[];
  teams: { team_id: string; role: string }[];
};

/** Deriva o alcance do `/auth/me`. Quem tem os dois verbos fica com o amplo. */
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
