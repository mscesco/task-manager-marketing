// lib/rascunhoSolicitacao.ts
// Rascunho local do formulário público (FazAê).
//
// POR QUE EXISTE: com multi-seleção, quem escolhe 4 categorias preenche
// um formulário longo. Fechou a aba no meio, perdeu tudo — e não recomeça.
// O rascunho fica só no navegador de quem preenche (localStorage): nada
// vai pro servidor antes do envio, então rascunho não polui a fila de
// triagem nem cria solicitação fantasma.
//
// ⚠️ localStorage é POR NAVEGADOR. Se o coordenador começa no celular e
// termina no desktop, o rascunho não acompanha. É o preço de não gravar
// nada no servidor antes do envio — e é o tradeoff certo aqui.
//
// TTL de 7 dias: rascunho velho confunde mais do que ajuda ("por que esse
// formulário já veio preenchido?"). Depois disso é descartado sozinho.

const CHAVE = "fazae:rascunho-solicitacao:v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RascunhoSolicitacao = {
  salvoEm: number;
  ident: Record<string, string>;
  selecionadas: string[];
  valores: Record<string, Record<string, string | string[]>>;
  passo: number;
};

/** Lê o rascunho. Devolve null se não existe, expirou ou está corrompido. */
export function lerRascunho(): RascunhoSolicitacao | null {
  if (typeof window === "undefined") return null; // SSR
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as RascunhoSolicitacao;
    if (!dados?.salvoEm || Date.now() - dados.salvoEm > TTL_MS) {
      window.localStorage.removeItem(CHAVE);
      return null;
    }
    // Rascunho sem nada de útil não vale o banner de "continuar".
    const temAlgo =
      dados.selecionadas?.length > 0 ||
      Object.values(dados.ident ?? {}).some((v) => v?.trim());
    return temAlgo ? dados : null;
  } catch {
    // JSON quebrado / storage bloqueado (aba anônima, cookies off):
    // rascunho é conveniência, nunca pode derrubar o formulário.
    return null;
  }
}

export function salvarRascunho(
  dados: Omit<RascunhoSolicitacao, "salvoEm">
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({ ...dados, salvoEm: Date.now() })
    );
  } catch {
    // Cota estourada ou storage indisponível: segue sem rascunho.
  }
}

export function limparRascunho(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* idem */
  }
}

export function descreverIdade(salvoEm: number): string {
  const minutos = Math.floor((Date.now() - salvoEm) / 60000);
  if (minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}
