// Estado da tela do time (visão e aba) guardado na URL, para sobreviver ao recarregar.
// `history.replaceState`, não `router.replace`: trocar de aba não é navegação e o Next remontaria a rota.

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

/** Lê o estado da URL; valor desconhecido cai no padrão. Os nomes na URL são em português porque a pessoa os lê. */
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

/** Grava na URL sem navegar. */
export function gravarEstadoDaTela(estado: EstadoDaTela): void {
  if (typeof window === "undefined") return;
  const q = urlDoEstado(estado, window.location.search);
  window.history.replaceState(null, "", `${window.location.pathname}${q}`);
}
