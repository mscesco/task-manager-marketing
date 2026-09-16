// web/lib/markdown.ts
// =====================================================================
// Formatação nas descrições de projeto e tarefa (Spec 052, fatia C).
//
// Fronteira da Spec 027: `lib/` decide, `components/` desenha. Aqui mora:
//   - o que o renderizador PODE desenhar (a lista do que é permitido);
//   - quais endereços viram link;
//   - o texto sem marcação, para os resumos.
//
// ⚠️ A BARRA QUE ESCREVIA ASTERISCOS (`aplicarNaSelecao`) SAIU na fatia E: o
// editor agora mostra formatado, e a configuração dele mora em
// `lib/editorDeDescricao.ts`.
//
// ⚠️ A SEGURANÇA MORA NA LISTA DO QUE É PERMITIDO (spec §4.3). O que não está em
// `ELEMENTOS_PERMITIDOS` é desembrulhado (fica o texto) ou some. HTML escrito à
// mão NUNCA vira HTML: sem `rehype-raw`, o `react-markdown` o desenha como
// texto -- medido em 16/09, e preso em teste.
// =====================================================================

/**
 * O que a descrição desenha. Tabela, imagem, código, citação, risco e linha
 * horizontal ficam de fora (spec §4.3): o conteúdo deles aparece como texto
 * corrido, ou some quando não tem texto (imagem, linha).
 */
export const ELEMENTOS_PERMITIDOS: readonly string[] = [
  "p",
  "br",
  "strong",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
];

const ESQUEMAS_PERMITIDOS = new Set(["http:", "https:", "mailto:"]);

/**
 * O endereço de um link, ou `null` se ele não pode virar link.
 *
 * ⚠️ `null`, e não string vazia: o componente desenha o texto SEM `<a>`. Um
 * `<a href="">` recarregaria a página ao ser clicado.
 *
 * ⚠️ ENDEREÇO SEM ESQUEMA (`/tarefa/x`, `#algo`) TAMBÉM NÃO: a descrição é texto
 * de usuário, e link relativo levaria a lugares do próprio app que ninguém
 * pretendeu -- inclusive à rota de API.
 */
export function enderecoSeguro(url: string | null | undefined): string | null {
  if (!url) return null;
  const limpo = url.trim();
  let esquema: string;
  try {
    esquema = new URL(limpo).protocol;
  } catch {
    return null;
  }
  return ESQUEMAS_PERMITIDOS.has(esquema.toLowerCase()) ? limpo : null;
}

/**
 * O texto sem a marcação, para onde a descrição aparece RESUMIDA (a lista de
 * projetos). Um resumo com `**` e `##` parece defeito (spec §4.3).
 *
 * ⚠️ NÃO É UM PARSER, e não precisa ser: o resultado vai para uma linha cortada
 * com reticências e para um `title`. Errar num caso raro deixa um asterisco à
 * mostra, e não quebra nada. O renderizador de verdade é o `react-markdown`.
 */
export function semMarcacao(texto: string): string {
  // ⚠️ O EDITOR DA FATIA E ESCAPA o que pareceria marcação (`\[Design\]`,
  // `2 \* 3`). O escape é GUARDADO antes das regras -- senão o `\*` de uma conta
  // viraria um asterisco solto que a regra do itálico comeria -- e devolvido no
  // fim, já sem a barra.
  const guardados: string[] = [];
  return texto
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_, c: string) => {
      guardados.push(c);
      return `${guardados.length - 1}`;
    })
    .split(/\r?\n/)
    .map((linha) =>
      linha
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
    )
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|\W)_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(\d+)/g, (_, i: string) => guardados[Number(i)]);
}
