// Concordância de número em contador de UI.

/** "1 cancelada" / "2 canceladas". Toda contagem que vira texto passa aqui. */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
