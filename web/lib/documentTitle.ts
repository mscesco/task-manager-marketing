// O nome da aba. As páginas são `"use client"` e não exportam `metadata`:
// cada rota tem um `layout.tsx` com o título fixo, e `useDocumentTitle` troca
// pelo específico quando o dado chega. O hook mora noutro arquivo porque o
// `app/layout.tsx` (servidor) importa `APP_NAME` daqui, e `useEffect` sem
// `"use client"` derruba o `next build`.

/** O nome do produto, do lado direito da aba. */
export const APP_NAME = "Oniros";

/**
 * O título completo de uma tela.
 *
 * O específico vem primeiro porque a aba corta pela direita. Tem de bater com
 * o `title.template` do `app/layout.tsx`.
 */
export function pageTitle(name?: string | null): string {
  const limpo = name?.trim();
  return limpo ? `${limpo} · ${APP_NAME}` : APP_NAME;
}
