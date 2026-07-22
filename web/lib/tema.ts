// Tema claro/escuro/sistema, persistido no localStorage.
//
// Contrato com o CSS: o atributo `data-theme` no <html> vale "claro" ou
// "escuro" -- NUNCA "sistema". "sistema" e uma PREFERENCIA guardada; o valor
// pintado na tela e sempre resolvido antes de ir pro DOM. O globals.css so
// conhece [data-theme="escuro"].
//
// Contrato com o script bloqueante do layout.tsx: a chave e os valores aqui
// precisam bater LETRA POR LETRA com os do script inline. Se um mudar e o
// outro nao, volta o flash branco no carregamento. Por isso as constantes
// estao exportadas -- o script nao consegue importa-las (roda antes do
// bundle), mas pelo menos ha um lugar unico pra conferir.

export type Tema = "claro" | "escuro" | "sistema";
export type TemaResolvido = "claro" | "escuro";

export const CHAVE_TEMA = "tm_theme";
export const TEMA_PADRAO: Tema = "sistema";

const CONSULTA_ESCURO = "(prefers-color-scheme: dark)";

function ehTema(v: string | null): v is Tema {
  return v === "claro" || v === "escuro" || v === "sistema";
}

/** Preferencia salva. Valor invalido ou ausente -> padrao. */
export function lerTema(): Tema {
  if (typeof window === "undefined") return TEMA_PADRAO;
  try {
    const v = window.localStorage.getItem(CHAVE_TEMA);
    return ehTema(v) ? v : TEMA_PADRAO;
  } catch {
    // localStorage pode lancar (modo privado, cookies bloqueados). Tema nao
    // vale quebrar a pagina -- cai no padrao.
    return TEMA_PADRAO;
  }
}

export function gravarTema(t: Tema): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE_TEMA, t);
  } catch {
    // Sem persistencia: o tema ainda vale nesta aba, so nao sobrevive ao F5.
  }
}

/** Traduz a preferencia no que deve ser pintado agora. */
export function resolverTema(t: Tema): TemaResolvido {
  if (t !== "sistema") return t;
  if (typeof window === "undefined" || !window.matchMedia) return "claro";
  return window.matchMedia(CONSULTA_ESCURO).matches ? "escuro" : "claro";
}

/** Escreve o resultado no <html>. */
export function aplicarTema(t: Tema): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolverTema(t));
}

/**
 * Observa a troca de tema do SO. So faz sentido com a preferencia em
 * "sistema" -- nos outros casos a escolha explicita manda.
 * Devolve a funcao de limpeza.
 */
export function observarTemaDoSistema(aoMudar: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(CONSULTA_ESCURO);
  mq.addEventListener("change", aoMudar);
  return () => mq.removeEventListener("change", aoMudar);
}

/** Ordem do botao que cicla: claro -> escuro -> sistema -> claro. */
export function proximoTema(t: Tema): Tema {
  return t === "claro" ? "escuro" : t === "escuro" ? "sistema" : "claro";
}

export const ROTULO_TEMA: Record<Tema, string> = {
  claro: "Tema: claro",
  escuro: "Tema: escuro",
  sistema: "Tema: sistema",
};
