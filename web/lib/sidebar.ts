// Estado da barra lateral, persistido no localStorage.
//
// ⚠️ POR QUE PRECISA SER PERSISTIDO, e nao e capricho: a navegacao do app e
// por `<a href>` -- RECARGA TOTAL a cada troca de tela (o mesmo fato que
// obriga o script bloqueante de tema no `layout.tsx`). Sem isto, todo
// `useState` da barra volta ao inicial: quem retrai a barra em "Projetos" a
// encontra aberta de novo em "Membros", e outra vez em "Times". Relatado pela
// Camila em 21/08.
//
// FRONTEIRA (Spec 027): ler e validar preferencia e DECISAO -- mora aqui, com
// teste proprio; a tela so chama.
//
// ⚠️ ESPELHA `lib/tema.ts` DE PROPOSITO, ate no try/catch: `localStorage`
// LANCA em modo privado com cookies bloqueados, e preferencia de barra lateral
// nao vale derrubar a pagina. Valor invalido ou ausente cai no padrao.
//
// ⚠️ NAO PRECISA DE SCRIPT BLOQUEANTE, diferente do tema. O `AppShell` comeca
// com `loading = true` e so desenha a barra depois do check de auth, ja no
// cliente -- entao ler no inicializador do `useState` nao diverge do SSR e nao
// produz piscada. O mesmo raciocinio ja esta escrito no `AppShell` para o
// tema. Se um dia a barra passar a renderizar antes do check, isto vira flash
// e precisa do script.

export const CHAVE_BARRA_ABERTA = "tm_sidebar_open";
export const CHAVE_QUADROS_ABERTO = "tm_sidebar_boards_open";

/** Padroes: barra aberta e grupo "Quadros" aberto — o comportamento de sempre. */
export const BARRA_ABERTA_PADRAO = true;
export const QUADROS_ABERTO_PADRAO = true;

function lerBooleano(chave: string, padrao: boolean): boolean {
  if (typeof window === "undefined") return padrao;
  try {
    const v = window.localStorage.getItem(chave);
    // ⚠️ Comparacao EXPLICITA com as duas strings, e nao `v === "true"`
    // sozinho: assim um valor corrompido ("1", "sim", lixo de outra versao)
    // cai no PADRAO em vez de virar `false` em silencio. Barra fechada sem
    // ninguem ter fechado e mais confuso que barra aberta.
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
