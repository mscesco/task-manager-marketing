// Formatação nas descrições de projeto e tarefa: o que o renderizador pode
// desenhar, quais endereços viram link e o texto sem marcação para resumos.
// A segurança está na lista do que é permitido; HTML escrito à mão nunca vira
// HTML (sem `rehype-raw`, o `react-markdown` o desenha como texto).

/**
 * O que a descrição desenha; o mesmo que o editor preserva. Imagem vira link
 * com o texto alternativo (não carrega endereço externo sozinha); a caixa de
 * tarefa (`input`) só aparece desabilitada.
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
  "code",
  "pre",
  "blockquote",
  "del",
  "hr",
  "img",
  "input",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const ESQUEMAS_PERMITIDOS = new Set(["http:", "https:", "mailto:"]);

/**
 * O endereço de um link, ou `null` se ele não pode virar link (o componente
 * desenha o texto sem `<a>`). Endereço sem esquema também não: link relativo
 * levaria a rotas do próprio app.
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
 * O texto sem a marcação, para onde a descrição aparece resumida. Não é um
 * parser: errar num caso raro só deixa um asterisco à mostra.
 */
export function semMarcacao(texto: string): string {
  // O editor escapa o que pareceria marcação (`2 \* 3`). O escape é guardado
  // antes das regras, para a do itálico não o comer, e devolvido no fim sem a
  // barra.
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
    // O editor grava `<`/`>` como entidades. `&amp;` por último, para
    // `&amp;lt;` virar `&lt;` literal, e não `<`.
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/(\d+)/g, (_, i: string) => guardados[Number(i)]);
}
