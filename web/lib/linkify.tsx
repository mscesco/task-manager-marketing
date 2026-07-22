import React from "react";

// Transforma URLs em <a> clicavel, devolvendo NOS REACT (nunca HTML cru --
// nao existe dangerouslySetInnerHTML em lugar nenhum do app e isso nao muda
// aqui). Usado na descricao da task e nos trechos de texto do comentario.
//
// SEGURANCA -- por que so http/https:
// O React 18 NAO bloqueia href="javascript:...", so emite warning e renderiza
// mesmo assim. Como comentario e conteudo de usuario, casar esquema livre
// (\S+:) seria vetor de XSS. A regex abaixo exige literalmente `http://` ou
// `https://`, entao javascript:/data:/file: nunca viram link -- ficam texto.
//
// Nao casa "www.x.com" sem esquema de proposito: exigiria inventar o https://
// e adivinhar intencao. Se aparecer necessidade, e uma decisao separada.

// Corpo da URL: para no primeiro espaco ou em caractere que costuma
// delimitar (aspas, sinal de menor/maior, crase de markdown).
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

// Fechamento -> abertura correspondente, pra decidir se o fecha-parenteses
// final pertence a URL ou ao texto em volta.
const PAR_ABRE: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

// Pontuacao que quase nunca faz parte da URL quando esta no fim.
const PONTUACAO_FINAL = new Set([".", ",", ";", ":", "!", "?"]);

function contar(texto: string, alvo: string): number {
  let n = 0;
  for (const c of texto) if (c === alvo) n++;
  return n;
}

// Apara o rabo da URL. Dois casos:
//   "veja https://x.com/a."      -> o ponto final e da frase, nao do link
//   "(ver https://x.com/a)"      -> o ) fecha o parenteses do texto
// Mas "https://x.com/wiki/A_(b)" mantem o ) -- ele esta balanceado dentro
// da propria URL. Por isso a contagem em vez de cortar cego.
function apararFim(url: string): string {
  let fim = url.length;
  while (fim > 0) {
    const ch = url[fim - 1];
    if (PONTUACAO_FINAL.has(ch)) {
      fim--;
      continue;
    }
    const abre = PAR_ABRE[ch];
    if (abre !== undefined) {
      const trecho = url.slice(0, fim);
      if (contar(trecho, ch) > contar(trecho, abre)) {
        fim--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, fim);
}

/**
 * Quebra um texto puro em nos React, virando <a> onde houver URL.
 *
 * @param texto    trecho SEM tokens (o chamador ja extraiu mencao/gif).
 * @param prefixo  prefixo de key, unico por chamada (evita colisao quando
 *                 varios trechos do mesmo comentario sao linkificados).
 */
export function linkify(texto: string, prefixo: string): React.ReactNode[] {
  if (!texto) return [];

  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let i = 0;

  for (const m of texto.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    const bruto = m[0];
    const url = apararFim(bruto);

    // Sobrou so o esquema ("https://" seco, ou "https://." aparado ate o
    // osso): nao e link util -> deixa o texto como estava.
    if (url.replace(/^https?:\/\//, "").length === 0) continue;

    if (idx > ultimo) partes.push(texto.slice(ultimo, idx));

    partes.push(
      <a
        key={`${prefixo}${i++}`}
        href={url}
        target="_blank"
        // noopener: a aba nova nao ganha window.opener (trava tabnabbing).
        // noreferrer: nao vaza a URL interna no Referer.
        rel="noopener noreferrer"
        style={{ color: "var(--accent)", textDecoration: "underline" }}
      >
        {url}
      </a>
    );

    // Avanca so ate o fim da URL APARADA -- o que foi aparado (ponto final,
    // parenteses) volta como texto no proximo slice, sem sumir da tela.
    ultimo = idx + url.length;
  }

  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

export default linkify;
