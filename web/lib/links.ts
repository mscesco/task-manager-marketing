// web/lib/links.ts
// =====================================================================
// Links com nome de projeto e de tarefa (Spec 052, fatia B).
//
// Fronteira da Spec 027: `lib/` decide, `components/` desenha. O editor da
// lista pergunta aqui o que é válido, o que mudou e como reordenar.
//
// ⚠️ O SERVIDOR É QUEM GARANTE: nome não vazio, `http`/`https`, até 20. Isto só
// evita mandar o que vai voltar com 422 -- e completa o `https://` que quase
// todo mundo esquece ao colar do Drive.
// =====================================================================

import type { LinkItem } from "./api";

/** Mesmos tetos do servidor (`link_service.py`). */
export const MAX_LINKS = 20;
export const TITULO_MAXIMO = 120;
export const URL_MAXIMA = 2048;

/** Uma linha do editor. `chave` só existe para o React não trocar as linhas. */
export type RascunhoLink = { chave: string; title: string; url: string };

export type ErroDoLink = { title?: string; url?: string };

let contador = 0;
function novaChave(): string {
  contador += 1;
  return `l${contador}`;
}

export function rascunhoDe(links: readonly LinkItem[]): RascunhoLink[] {
  return links.map((l) => ({ chave: novaChave(), title: l.title, url: l.url }));
}

export function linhaVazia(): RascunhoLink {
  return { chave: novaChave(), title: "", url: "" };
}

/**
 * Completa o esquema quando falta: `drive.google.com/x` vira
 * `https://drive.google.com/x`.
 *
 * ⚠️ SÓ QUANDO NÃO HÁ ESQUEMA NENHUM. `javascript:` e `ftp:` ficam como estão,
 * e o servidor os recusa -- colar um `https://` na frente de `javascript:...`
 * transformaria a tentativa num link "válido" e estranho.
 */
export function completarEndereco(url: string): string {
  const limpo = url.trim();
  if (!limpo) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(limpo)) return limpo;
  return `https://${limpo.replace(/^\/+/, "")}`;
}

const URL_VALIDA = /^https?:\/\/\S+$/i;

/**
 * Os erros de cada linha, na mesma ordem. Linha TOTALMENTE vazia não é erro:
 * ela é descartada no envio (é o "+ Adicionar link" que a pessoa não usou).
 */
export function errosDosLinks(rascunho: readonly RascunhoLink[]): ErroDoLink[] {
  return rascunho.map((l) => {
    const titulo = l.title.trim();
    const url = completarEndereco(l.url);
    if (!titulo && !url) return {};
    const erro: ErroDoLink = {};
    if (!titulo) erro.title = "Dê um nome ao link.";
    else if (titulo.length > TITULO_MAXIMO)
      erro.title = `No máximo ${TITULO_MAXIMO} caracteres.`;
    if (!url) erro.url = "Falta o endereço.";
    else if (url.length > URL_MAXIMA || !URL_VALIDA.test(url))
      erro.url = "O endereço precisa começar com http:// ou https://.";
    return erro;
  });
}

export function temErro(erros: readonly ErroDoLink[]): boolean {
  return erros.some((e) => e.title !== undefined || e.url !== undefined);
}

/** A lista como vai ao servidor: aparada, com `https://`, sem linha vazia. */
export function paraEnvio(
  rascunho: readonly RascunhoLink[],
): { title: string; url: string }[] {
  return rascunho
    .map((l) => ({ title: l.title.trim(), url: completarEndereco(l.url) }))
    .filter((l) => l.title || l.url);
}

/** Passou do teto? Conta só as linhas que vão ser enviadas. */
export function passaDoTeto(rascunho: readonly RascunhoLink[]): boolean {
  return paraEnvio(rascunho).length > MAX_LINKS;
}

/**
 * A lista mudou em relação ao que está salvo? Compara o que SERIA ENVIADO, e
 * não o texto cru: acrescentar uma linha e deixá-la vazia, ou um espaço no fim
 * do nome, não conta como mudança -- não vale uma ida ao servidor.
 */
export function linksMudaram(
  salvos: readonly LinkItem[],
  rascunho: readonly RascunhoLink[],
): boolean {
  const envio = paraEnvio(rascunho);
  if (envio.length !== salvos.length) return true;
  return envio.some((l, i) => l.title !== salvos[i].title || l.url !== salvos[i].url);
}

/** Move a linha `i` uma posição (`-1` sobe, `+1` desce). Fora da lista, nada. */
export function moverLink<T>(lista: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return [...lista];
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

/**
 * A lista a ENVIAR ao salvar, ou `null` para não mexer nos links.
 *
 * ⚠️⚠️ SÓ COM OS DOIS LADOS CONHECIDOS (revisão de 16/09). `salvos === null` é
 * "a lista salva ainda não chegou, ou a busca falhou" -- e não "sem links".
 * Comparar um rascunho com uma lista que a tela nunca viu fazia o `PUT` mandar
 * a lista vazia (ou só o link novo) e APAGAR os links que existiam.
 */
export function linksParaEnviar(
  salvos: readonly LinkItem[] | null,
  rascunho: readonly RascunhoLink[] | null,
): { title: string; url: string }[] | null {
  if (salvos === null || rascunho === null) return null;
  return linksMudaram(salvos, rascunho) ? paraEnvio(rascunho) : null;
}
