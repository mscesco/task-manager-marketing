import React from "react";

// Transforma URLs em <a> clicável, devolvendo nós React (nunca HTML cru).
// Só http/https: o React não bloqueia href="javascript:...", e o texto é do
// usuário. "www.x.com" sem esquema não vira link.

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
