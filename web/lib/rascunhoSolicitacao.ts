// Rascunho local do formulário público (FazAê), só no localStorage de quem
// preenche: nada vai ao servidor antes do envio. Expira em 7 dias.
//
// A chave é por formulário (`formId`, que não muda; o slug pode ser
// renomeado): `selecionadas` guarda slugs de seção, e restaurar o rascunho de
// outro formulário deixaria a tela em branco.
const PREFIXO = "fazae:rascunho-solicitacao:v2";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A chave deste formulario. Sem id, cai numa gaveta propria. */
function chave(formId: string): string {
  return `${PREFIXO}:${formId || "_"}`;
}

/** A chave global antiga, que ninguém lê mais. */
const CHAVE_V1 = "fazae:rascunho-solicitacao:v1";

/** Apaga o rascunho da chave global antiga, que nunca expiraria sozinho
 *  (a expiração só roda na leitura). Chamada a cada leitura. */
function aposentaOAntigo(): void {
  try {
    window.localStorage.removeItem(CHAVE_V1);
  } catch {
    /* storage bloqueado: rascunho é conveniência, nunca derruba a tela */
  }
}

export type RascunhoSolicitacao = {
  salvoEm: number;
  ident: Record<string, string>;
  selecionadas: string[];
  valores: Record<string, Record<string, string | string[]>>;
  passo: number;
  /** As repetições de cada seção (chaves de `valores`). Ausente = cada seção
   *  vale uma vez. */
  repeticoes?: Record<string, string[]>;
};

/** Lê o rascunho. Devolve null se não existe, expirou ou está corrompido. */
export function lerRascunho(formId: string): RascunhoSolicitacao | null {
  if (typeof window === "undefined") return null; // SSR
  aposentaOAntigo();
  try {
    const bruto = window.localStorage.getItem(chave(formId));
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as RascunhoSolicitacao;
    if (!dados?.salvoEm || Date.now() - dados.salvoEm > TTL_MS) {
      window.localStorage.removeItem(chave(formId));
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
  formId: string,
  dados: Omit<RascunhoSolicitacao, "salvoEm">
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      chave(formId),
      JSON.stringify({ ...dados, salvoEm: Date.now() })
    );
  } catch {
    // Cota estourada ou storage indisponível: segue sem rascunho.
  }
}

export function limparRascunho(formId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chave(formId));
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
