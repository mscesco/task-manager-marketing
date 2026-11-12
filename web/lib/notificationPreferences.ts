// Regras do cartão "Notificações" do Meu perfil: linhas, colunas e rótulos
// da grade. Espelha o catálogo do backend (`notifications/domain/preferences.py`):
// chaves e papéis têm de casar, senão o toggle devolve 422.

import type { NotificationToggle } from "./api";

/** Os papéis. `none` = a linha não se divide por papel. */
export type Role = "watcher" | "assignee" | "creator" | "none";

/** As colunas da grade, em ordem. */
export const COLUMNS: readonly { readonly role: Role; readonly label: string }[] = [
  { role: "watcher", label: "Seguidor" },
  { role: "assignee", label: "Responsável" },
  { role: "creator", label: "Criador" },
];

export type PreferenceRow = {
  /** `type_group` do contrato da API. */
  readonly group: string;
  readonly label: string;
  /** Quais colunas esta linha tem. `["none"]` = um toggle só. */
  readonly roles: readonly Role[];
  readonly locked: boolean;
  /** Por que é travada. Só nas travadas. */
  readonly help?: string;
};

export type PreferenceSection = {
  readonly title: string;
  readonly rows: readonly PreferenceRow[];
};

const BY_ROLE: readonly Role[] = ["watcher", "assignee", "creator"];
/** Prazo não tem coluna de seguidor: o aviso nunca chega por seguir. */
const ASSIGNEE_AND_CREATOR: readonly Role[] = ["assignee", "creator"];
const SINGLE: readonly Role[] = ["none"];

export const SECTIONS: readonly PreferenceSection[] = [
  {
    title: "Comentários",
    rows: [
      { group: "comment", label: "Comentário novo", roles: BY_ROLE, locked: false },
    ],
  },
  {
    title: "Andamento da tarefa",
    rows: [
      { group: "column", label: "Mudança de coluna", roles: BY_ROLE, locked: false },
      { group: "due", label: "Mudança de prazo", roles: BY_ROLE, locked: false },
      {
        group: "description",
        label: "Edição da descrição",
        roles: BY_ROLE,
        locked: false,
      },
      {
        group: "archive",
        label: "Arquivar e desarquivar",
        roles: BY_ROLE,
        locked: false,
      },
      { group: "deleted", label: "Exclusão", roles: BY_ROLE, locked: false },
    ],
  },
  {
    title: "Prazos",
    rows: [
      {
        group: "due_soon",
        label: "Prazo chegando",
        roles: ASSIGNEE_AND_CREATOR,
        locked: false,
      },
      {
        group: "overdue",
        label: "Prazo vencido",
        roles: ASSIGNEE_AND_CREATOR,
        locked: false,
      },
    ],
  },
  {
    title: "Sobre você",
    rows: [
      {
        group: "reply",
        label: "Resposta ao seu comentário",
        roles: SINGLE,
        locked: false,
      },
      {
        group: "reaction",
        label: "Reação ao seu comentário",
        roles: SINGLE,
        locked: false,
      },
      {
        group: "watch",
        label: "Alguém pôr ou tirar você como seguidor",
        roles: SINGLE,
        locked: false,
      },
    ],
  },
  {
    title: "Sempre ligados",
    rows: [
      {
        group: "mention",
        label: "Menção",
        roles: SINGLE,
        locked: true,
        help: "Alguém chamou você com @ — sempre avisa.",
      },
      {
        group: "assigned",
        label: "Designação",
        roles: SINGLE,
        locked: true,
        help: "Você virou responsável — sempre avisa.",
      },
      {
        group: "access_lost",
        label: "Perda de acesso",
        roles: SINGLE,
        locked: true,
        help: "Você deixou de ver tarefas — sempre avisa.",
      },
    ],
  },
];

export const ROWS: readonly PreferenceRow[] = SECTIONS.flatMap((s) => s.rows);

/** A grade indexada por `grupo:papel`, para achar cada célula em O(1). */
export type ToggleMap = ReadonlyMap<string, NotificationToggle>;

export function toggleKey(group: string, role: Role): string {
  return `${group}:${role}`;
}

export function indexToggles(toggles: readonly NotificationToggle[]): ToggleMap {
  return new Map(toggles.map((t) => [toggleKey(t.type_group, t.role as Role), t]));
}

/** O toggle está ligado? Ausente conta como ligado, como no servidor (sem
 *  linha em `notification_mute` = ligado). */
export function isEnabled(map: ToggleMap, group: string, role: Role): boolean {
  return map.get(toggleKey(group, role))?.enabled ?? true;
}

/** Quantos toggles estão desligados -- o resumo do cabeçalho do cartão. */
export function countDisabled(toggles: readonly NotificationToggle[]): number {
  return toggles.filter((t) => !t.enabled && !t.locked).length;
}

/** O texto do resumo. Nada desligado = frase que diz isso, e não "0". */
export function summary(toggles: readonly NotificationToggle[]): string {
  const n = countDisabled(toggles);
  if (n === 0) return "Você recebe todos os avisos.";
  return n === 1 ? "1 aviso desligado." : `${n} avisos desligados.`;
}

/** O nome acessível do interruptor: linha e coluna, para o leitor de tela. */
export function toggleLabel(row: PreferenceRow, role: Role): string {
  const column = COLUMNS.find((c) => c.role === role);
  return column ? `${row.label}, como ${column.label.toLowerCase()}` : row.label;
}
