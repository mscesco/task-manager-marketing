/**
 * "Esta tarefa está atrasada?", com hora opcional.
 *
 * Compara strings: os dois lados são normalizados ao mesmo formato antes, senão
 * o prefixo mais curto perde sempre ("2026-08-19" < "2026-08-19 18:00").
 * Não use `new Date` sobre data do backend: `new Date("2026-08-19")` é UTC e
 * escorrega um dia em fuso negativo.
 */

/** Fuso em que "hoje" e "agora" são decididos; fixo para bater com o job de prazo do backend. */
export const FUSO_DO_WORKSPACE = "America/Sao_Paulo";

/** "Agora" no fuso do workspace, já em texto comparável. */
export type Agora = {
  /** `YYYY-MM-DD` */
  readonly data: string;
  /** `HH:MM`, 24h */
  readonly hora: string;
};

/** Normaliza a hora do backend (`"18:00:00"`, com segundos) para `HH:MM`. */
function hhmm(hora: string): string {
  return hora.slice(0, 5);
}

/**
 * `Agora` no fuso do workspace, via `Intl` (offset fixo quebra com horário de
 * verão). `en-CA` porque formata `YYYY-MM-DD`, que ordena como string.
 */
export function agoraNoWorkspace(agora: Date = new Date()): Agora {
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DO_WORKSPACE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const hora = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_DO_WORKSPACE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(agora);
  return { data, hora: hhmm(hora) };
}

/**
 * Data e hora curtas de um instante (ex.: "24/06 14:30"). Usa o fuso do
 * navegador de propósito: é carimbo de quando algo aconteceu, não prazo.
 */
export function dataHoraCurta(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** O dia (`YYYY-MM-DD`) de um instante ISO, no fuso do workspace. */
export function diaNoWorkspace(iso: string): string {
  return agoraNoWorkspace(new Date(iso)).data;
}

/**
 * A tarefa passou do prazo? Sem hora, atrasa quando o dia acaba; com hora, no
 * instante. Hora sem data devolve `false`.
 */
export function estaAtrasada(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
  agora: Agora
): boolean {
  if (!dueDate) return false;
  if (!dueTime) return dueDate < agora.data;
  return `${dueDate} ${hhmm(dueTime)}` < `${agora.data} ${agora.hora}`;
}
