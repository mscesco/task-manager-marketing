/**
 * O que a tela do time lembra ao recarregar — Spec 047, revisão de 10/09.
 *
 * ⚠️⚠️ RELATADO NA TELA: *"se eu recarrego a tela, ela não lembra onde eu
 * estava"*. O alternador e as abas viviam só em `useState`, e o F5 os jogava
 * de volta em "Membros / Ativos".
 *
 * ⚠️ NA URL, E NÃO NO `localStorage`, e a diferença é o que se ganha de
 * graça: um endereço com `?ver=subtimes&aba=inativos` é COMPARTILHÁVEL e faz
 * o botão Voltar funcionar. Guardado no navegador, o estado seria invisível e
 * pessoal — duas pessoas abririam o mesmo link e veriam coisas diferentes. É a
 * mesma razão da §4.4 da Spec 046 para pôr a área na URL.
 *
 * ⚠️ `history.replaceState` E NÃO `router.replace`: trocar de aba não é
 * navegação, é ajuste de recorte. Com `push` o Voltar percorreria cada clique
 * de aba; com `router.replace` o Next remonta a árvore da rota e a tabela
 * pisca. O `replaceState` do próprio navegador troca só o endereço.
 *
 * FRONTEIRA (Spec 027): a leitura e a escrita moram aqui porque `app/` está
 * fora do `include` do vitest — e o defeito clássico deste tipo de código
 * (ler um valor inválido da URL e cair num estado que a tela não desenha) não
 * dá erro nenhum, só uma tela vazia.
 */

import type { MemberState } from "./memberState";

export type ViewDaTela = "people" | "structure";

export type EstadoDaTela = {
  readonly view: ViewDaTela;
  readonly tab: MemberState;
};

const PADRAO: EstadoDaTela = { view: "people", tab: "active" };

const VIEWS: Record<string, ViewDaTela> = {
  membros: "people",
  subtimes: "structure",
};
const ABAS: Record<string, MemberState> = {
  ativos: "active",
  convidados: "invited",
  inativos: "inactive",
};

/**
 * Lê o estado da barra de endereços.
 *
 * ⚠️⚠️ VALOR DESCONHECIDO CAI NO PADRÃO, e isso não é zelo excessivo: a URL é
 * digitável, e um `?aba=lixo` que virasse estado faria a tabela filtrar por um
 * estado que ninguém tem — tela vazia, sem erro, sem explicação.
 *
 * ⚠️ E os nomes na URL são em PORTUGUÊS de propósito: eles são interface, e
 * quem lê o endereço é a pessoa. O tipo por trás é que é em inglês.
 */
export function lerEstadoDaTela(busca?: string): EstadoDaTela {
  const cru =
    busca ?? (typeof window === "undefined" ? "" : window.location.search);
  const params = new URLSearchParams(cru);
  return {
    view: VIEWS[params.get("ver") ?? ""] ?? PADRAO.view,
    tab: ABAS[params.get("aba") ?? ""] ?? PADRAO.tab,
  };
}

/** O endereço que representa este estado, preservando o resto da query. */
export function urlDoEstado(estado: EstadoDaTela, busca: string): string {
  const params = new URLSearchParams(busca);
  const ver = Object.keys(VIEWS).find((k) => VIEWS[k] === estado.view);
  const aba = Object.keys(ABAS).find((k) => ABAS[k] === estado.tab);
  if (ver) params.set("ver", ver);
  if (aba) params.set("aba", aba);
  const q = params.toString();
  return q === "" ? "" : `?${q}`;
}

/** Grava sem navegar — ver o bloco no topo. */
export function gravarEstadoDaTela(estado: EstadoDaTela): void {
  if (typeof window === "undefined") return;
  const q = urlDoEstado(estado, window.location.search);
  window.history.replaceState(null, "", `${window.location.pathname}${q}`);
}
