// web/lib/markdown.ts
// =====================================================================
// Formatação nas descrições de projeto e tarefa (Spec 052, fatia C).
//
// Fronteira da Spec 027: `lib/` decide, `components/` desenha. Aqui mora:
//   - o que o renderizador PODE desenhar (a lista do que é permitido);
//   - quais endereços viram link;
//   - o texto sem marcação, para os resumos;
//   - o que cada botão da barra escreve em volta da seleção.
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
  return texto
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
    .replace(/`([^`\n]+)`/g, "$1");
}

// ---------------------------------------------------------------- a barra

export type AcaoDaBarra = "negrito" | "italico" | "titulo" | "lista" | "numerada" | "link";

/** O texto depois do botão, e a seleção que deve ficar marcada. */
export type Edicao = { texto: string; inicio: number; fim: number };

function envolver(texto: string, inicio: number, fim: number, marca: string, vazio: string): Edicao {
  const antes = texto.slice(0, inicio);
  const sel = texto.slice(inicio, fim);
  const depois = texto.slice(fim);
  const n = marca.length;

  // ⚠️ APERTAR DE NOVO DESFAZ. Selecionar `**x**` inteiro, ou só `x` com as
  // marcas em volta, e apertar B tira o negrito -- é o que todo editor faz, e
  // sem isso o segundo clique produziria `****x****`.
  if (sel.length >= 2 * n && sel.startsWith(marca) && sel.endsWith(marca)) {
    const miolo = sel.slice(n, sel.length - n);
    return { texto: antes + miolo + depois, inicio, fim: inicio + miolo.length };
  }
  if (antes.endsWith(marca) && depois.startsWith(marca) && sel.length > 0) {
    return {
      texto: antes.slice(0, -n) + sel + depois.slice(n),
      inicio: inicio - n,
      fim: fim - n,
    };
  }

  // ⚠️ ESPAÇO NAS PONTAS FICA FORA DA MARCA. Duplo clique numa palavra costuma
  // selecionar o espaço seguinte, e `**palavra **` não é negrito no Markdown.
  const miolo = sel.trim();
  if (!miolo) {
    // Sem seleção: escreve um exemplo JÁ SELECIONADO, para a pessoa digitar
    // por cima. `****` com o cursor no meio é invisível para quem não conhece.
    const novo = antes + marca + vazio + marca + depois;
    return { texto: novo, inicio: inicio + n, fim: inicio + n + vazio.length };
  }
  const esq = sel.length - sel.trimStart().length;
  const dir = sel.length - sel.trimEnd().length;
  const novo =
    antes + sel.slice(0, esq) + marca + miolo + marca + sel.slice(sel.length - dir) + depois;
  const ini = inicio + esq + n;
  return { texto: novo, inicio: ini, fim: ini + miolo.length };
}

/** As linhas inteiras tocadas pela seleção: `[começo da primeira, fim da última]`. */
function linhasDaSelecao(texto: string, inicio: number, fim: number): [number, number] {
  const a = texto.lastIndexOf("\n", inicio - 1) + 1;
  // Seleção que termina logo depois de uma quebra não pega a linha seguinte.
  const ultimo = fim > inicio && texto[fim - 1] === "\n" ? fim - 1 : fim;
  const b = texto.indexOf("\n", ultimo);
  return [a, b === -1 ? texto.length : b];
}

function prefixar(
  texto: string,
  inicio: number,
  fim: number,
  prefixoDe: (i: number) => string,
  jaTem: RegExp,
): Edicao {
  const [a, b] = linhasDaSelecao(texto, inicio, fim);
  const linhas = texto.slice(a, b).split("\n");
  const cheias = linhas.filter((l) => l.trim());
  // ⚠️ SE TODAS AS LINHAS JÁ TÊM, TIRA de todas -- o mesmo "apertar de novo
  // desfaz" da marca em volta. Misturado, põe em todas.
  const tirar = cheias.length > 0 && cheias.every((l) => jaTem.test(l));
  let n = 0;
  const novas = linhas.map((l) => {
    if (tirar) return l.replace(jaTem, "");
    if (!l.trim() && linhas.length > 1) return l;
    const semAntigo = l.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "");
    return prefixoDe(n++) + semAntigo;
  });
  const bloco = novas.join("\n");
  return { texto: texto.slice(0, a) + bloco + texto.slice(b), inicio: a, fim: a + bloco.length };
}

/**
 * O que um botão (ou atalho) da barra faz com o texto e a seleção.
 *
 * ⚠️ PURA DE PROPÓSITO: o componente só lê a seleção do `textarea`, chama isto e
 * aplica. Assim cada botão tem teste sem DOM (spec §5, fatia C: "cada botão da
 * barra escrevendo a marcação certa").
 */
export function aplicarNaSelecao(
  acao: AcaoDaBarra,
  texto: string,
  inicio: number,
  fim: number,
): Edicao {
  switch (acao) {
    case "negrito":
      return envolver(texto, inicio, fim, "**", "texto em negrito");
    case "italico":
      return envolver(texto, inicio, fim, "*", "texto em itálico");
    case "titulo":
      return prefixar(texto, inicio, fim, () => "## ", /^\s{0,3}#{1,6}\s+/);
    case "lista":
      return prefixar(texto, inicio, fim, () => "- ", /^\s*[-*+]\s+/);
    case "numerada":
      return prefixar(texto, inicio, fim, (i) => `${i + 1}. `, /^\s*\d+[.)]\s+/);
    case "link": {
      const sel = texto.slice(inicio, fim).trim();
      const antes = texto.slice(0, inicio);
      const depois = texto.slice(fim);
      // Selecionou um ENDEREÇO: ele vai para dentro dos parênteses, e o nome
      // fica selecionado para a pessoa escrever.
      if (/^(https?:\/\/|www\.)\S+$/i.test(sel)) {
        const nome = "nome do link";
        const url = sel.startsWith("www.") ? `https://${sel}` : sel;
        return {
          texto: `${antes}[${nome}](${url})${depois}`,
          inicio: inicio + 1,
          fim: inicio + 1 + nome.length,
        };
      }
      // Selecionou um NOME (ou nada): o endereço fica selecionado.
      const nome = sel || "nome do link";
      const url = "https://";
      const ini = inicio + 1 + nome.length + 2;
      return {
        texto: `${antes}[${nome}](${url})${depois}`,
        inicio: ini,
        fim: ini + url.length,
      };
    }
  }
}

/** O atalho de teclado da barra, ou `null`. Ctrl no Windows, Cmd no Mac. */
export function acaoDoAtalho(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): AcaoDaBarra | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case "b":
      return "negrito";
    case "i":
      return "italico";
    case "k":
      return "link";
    default:
      return null;
  }
}
