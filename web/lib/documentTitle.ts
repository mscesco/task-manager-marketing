// lib/documentTitle.ts
// O nome da aba (revisão de títulos, 21/09).
//
// ⚠️ TODA TELA TINHA O MESMO NOME: "Gestor de Tarefas — UniFECAF", em todas as
// vinte rotas. Com cinco abas abertas as cinco se chamavam igual, e o histórico
// do navegador, os favoritos e o anúncio do leitor de tela ao trocar de página
// também (WCAG 2.4.2).
//
// ⚠️ AS PÁGINAS SÃO TODAS `"use client"`, e página de cliente NÃO pode exportar
// `metadata`. Por isso há duas peças:
//
//   1. um `layout.tsx` por rota, que é servidor e declara o título FIXO -- a
//      aba já nasce com o nome certo, antes de qualquer JavaScript;
//   2. `useDocumentTitle` (em `lib/useDocumentTitle.ts`), para o que só se sabe
//      depois de carregar: o nome da tarefa, do projeto, do quadro, do time.
//
// ⚠️ O HOOK MORA NOUTRO ARQUIVO, e isso não é organização: o `app/layout.tsx` é
// SERVIDOR e importa o `APP_NAME` daqui. Um módulo que contém `useEffect` sem
// `"use client"` derruba o `next build` -- e com `"use client"` ele deixaria de
// servir ao layout. O `tsc` e o vitest passavam nos dois casos; quem acusou foi
// o build.
//
// O `layout.tsx` da rota dinâmica declara o nome GENÉRICO ("Tarefa"), e o hook
// o troca pelo específico quando o dado chega. Assim nunca há uma janela com o
// nome errado -- só um menos preciso.

/** O nome do produto, do lado direito da aba. */
export const APP_NAME = "Gestor de Tarefas";

/**
 * O título completo de uma tela.
 *
 * ⚠️ O ESPECÍFICO VEM PRIMEIRO porque a aba corta pela DIREITA: com o produto
 * na frente, dez abas viram dez "Gestor de Tarefas — …" indistinguíveis.
 *
 * ⚠️ É O MESMO MODELO do `title.template` do `app/layout.tsx` -- as duas peças
 * têm de produzir a mesma frase, senão a aba muda de formato quando o hook
 * substitui o título do layout.
 */
export function pageTitle(name?: string | null): string {
  const limpo = name?.trim();
  return limpo ? `${limpo} · ${APP_NAME}` : APP_NAME;
}
