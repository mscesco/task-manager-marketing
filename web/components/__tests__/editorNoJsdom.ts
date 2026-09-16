// Spec 052, fatia E -- o que o editor da descrição precisa do navegador e o
// jsdom não tem.
//
// ⚠️ O JSDOM NÃO FAZ LAYOUT: `getClientRects` e `getBoundingClientRect` de
// `Range` não existem. O ProseMirror os chama ao pôr o cursor e rolar até ele
// (`focus("end")`), e sem eles o teste passa mas a suíte termina com "Unhandled
// Error" -- que o vitest conta como falha.
//
// Medidas VAZIAS, e não inventadas: nenhum teste deste projeto afirma posição
// na tela (web/AGENTS.md: largura e corte são conferência na tela).
export function prepararEditorNoJsdom() {
  const vazio = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON: () => ({}),
  });
  const lista = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = lista;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = vazio as () => DOMRect;
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
}
