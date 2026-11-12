// Estado da barra lateral, persistido no localStorage: a navegação é por
// `<a href>` (recarga total), e sem isso a barra voltaria ao inicial a cada
// tela. `localStorage` lança em modo privado, daí o try/catch. Não precisa de
// script bloqueante: o `AppShell` só desenha a barra depois do check de auth.

export const CHAVE_BARRA_ABERTA = "tm_sidebar_open";
export const CHAVE_QUADROS_ABERTO = "tm_sidebar_boards_open";

/** Padroes: barra aberta e grupo "Quadros" aberto — o comportamento de sempre. */
export const BARRA_ABERTA_PADRAO = true;
export const QUADROS_ABERTO_PADRAO = true;

function lerBooleano(chave: string, padrao: boolean): boolean {
  if (typeof window === "undefined") return padrao;
  try {
    const v = window.localStorage.getItem(chave);
    // As duas strings explícitas: valor corrompido cai no padrão, não em `false`.
    if (v === "true") return true;
    if (v === "false") return false;
    return padrao;
  } catch {
    return padrao;
  }
}

function gravarBooleano(chave: string, valor: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(chave, String(valor));
  } catch {
    // Sem persistencia: vale nesta tela, so nao sobrevive a troca de pagina.
  }
}

/** A barra esta aberta? */
export function lerBarraAberta(): boolean {
  return lerBooleano(CHAVE_BARRA_ABERTA, BARRA_ABERTA_PADRAO);
}

export function gravarBarraAberta(aberta: boolean): void {
  gravarBooleano(CHAVE_BARRA_ABERTA, aberta);
}

/** O grupo "Quadros" (accordion) esta aberto? */
export function lerQuadrosAberto(): boolean {
  return lerBooleano(CHAVE_QUADROS_ABERTO, QUADROS_ABERTO_PADRAO);
}

export function gravarQuadrosAberto(aberto: boolean): void {
  gravarBooleano(CHAVE_QUADROS_ABERTO, aberto);
}

// ---------------------------------------------------------------
// O menu muda de forma com a largura da tela.
// ---------------------------------------------------------------

export type FaixaDeTela = "celular" | "tablet" | "computador";

/** Por largura, e nunca por modelo de aparelho. Mesmos cortes de `md` e `lg`. */
export function faixaDaLargura(largura: number): FaixaDeTela {
  if (largura < 768) return "celular";
  if (largura < 1024) return "tablet";
  return "computador";
}

/**
 * O menu mostra os rotulos?
 *
 * `preferencia` (o "Retrair" gravado) só vale no computador; a gaveta do
 * celular/tablet é estado à parte, não gravado.
 */
export function barraExpandida(
  faixa: FaixaDeTela,
  preferencia: boolean,
  gavetaAberta: boolean,
): boolean {
  if (faixa === "computador") return preferencia;
  // No celular a gaveta fechada nem aparece: quando abre, e sempre com rotulos.
  if (faixa === "celular") return true;
  return gavetaAberta;
}
