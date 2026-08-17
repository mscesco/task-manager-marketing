// lib/plural.ts
//
// Concordancia de numero em contador de UI. Uma funcao, e ela nao pertence a
// nenhum dominio -- nem status, nem tarefa, nem time.
//
// ⚠️ SAIU DE `lib/status.ts` NA FATIA 4a (Spec 036 / ADR 0040). Estava la
// porque foi la que nasceu, e `lib/exclusao.ts` a importava de um modulo de
// status para pluralizar "subtarefa". A sondagem da fatia 4 (hoje no
// `plan.md`) mediu isso como evidencia de que o `status.ts` tinha virado
// gaveta: tres dos oito arquivos que o importam nao tem nada a ver com quadro.

/**
 * "1 cancelada" / "2 canceladas" (Spec 031, C7).
 *
 * Existe porque a linha de contadores da C4 nasceu com o plural cravado no
 * template e mostrava "1 canceladas" em producao. Contador de UI e sempre
 * candidato a n === 1 -- toda contagem que vira texto passa por aqui.
 */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
