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

// ⚠️⚠️ A CHAVE E POR FORMULARIO, e ate a revisao de 31/08 ela era GLOBAL.
//
// Isso era seguro quando havia UM formulario publico. A Spec 043 trouxe N por
// workspace, cada um com as suas secoes -- e `selecionadas` guarda SLUG DE
// SECAO. Com a chave global, o rascunho de um formulario vazava para outro:
// clicar em "Continuar de onde parei" restaurava secoes que o formulario atual
// nao tem, e a tela ficava **em branco**.
//
// ⚠️ E EM BRANCO DE VERDADE, nao com erro: as tres secoes do formulario
// (`passo === 0`, `categoriaAtual`, `naRevisao`) sao condicionais, e com
// `selecionadas` desconhecidas NENHUMA satisfaz a condicao. Na unica rota
// publica do produto, onde quem esta do outro lado nao tem conta, nem suporte,
// nem botao de sair.
//
// ⚠️ A CHAVE E O `formId`, E NAO O SLUG: o slug pode ser RENOMEADO no editor
// (`renomear_formulario` aceita o campo), e a chave mudaria junto -- o rascunho
// de quem estava preenchendo sumiria porque alguem do outro lado arrumou o
// endereco. O id nao muda nunca.
//
// ⚠️ O `v2` NO PREFIXO APOSENTA OS RASCUNHOS ANTIGOS de proposito: os
// gravados sob a chave global nao sabem de qual formulario vieram, entao nao
// da para migra-los com honestidade. Quem tiver um rascunho aberto perde o
// banner de "continuar" uma vez -- e o preco de nao restaurar num formulario
// errado.
const PREFIXO = "fazae:rascunho-solicitacao:v2";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A chave deste formulario. Sem id, cai numa gaveta propria. */
function chave(formId: string): string {
  return `${PREFIXO}:${formId || "_"}`;
}

/** A chave global antiga, que ninguém lê mais. */
const CHAVE_V1 = "fazae:rascunho-solicitacao:v1";

/**
 * Apaga o rascunho da chave global antiga.
 *
 * ⚠️ TROCAR O PREFIXO APOSENTOU OS `v1`, MAS NÃO OS APAGOU: nenhuma função
 * passou a lê-los, e nenhuma os removia -- então eles ficavam no navegador
 * **para sempre**, inclusive depois do TTL de 7 dias, porque a expiração só é
 * avaliada na leitura e ninguém lia. É pouco espaço, mas é o que alguém
 * digitou num formulário, guardado sem prazo de validade.
 *
 * ⚠️ E É CHAMADA NA LEITURA, não num efeito próprio: é o único ponto por onde
 * todo formulário público passa, e assim a limpeza acontece uma vez e some.
 */
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
