// lib/solicitacaoForm.ts
// Os TIPOS do formulário de solicitação e a regra de campo condicional.
//
// ⚠️ OS DADOS NÃO MORAM MAIS AQUI. Este arquivo era a definição declarativa
// do formulário do Marketing (`CATEGORIAS`, 11 categorias e 108 perguntas);
// desde a Spec 043 o formulário vem do banco -- a migration 0017 copiou o
// array -- e a lista estática ficou sem leitor. Saiu na limpeza de 17/09/2026;
// quem precisar do original acha no commit `2979442`.

export type CampoTipo =
  | "texto"
  | "textoLongo"
  | "escolha"
  | "multi"
  | "data"
  | "link";

export type Campo = {
  id: string;
  label: string;
  tipo: CampoTipo;
  obrigatorio?: boolean;
  opcoes?: string[];
  placeholder?: string;
  ajuda?: string;
  // Exibição condicional: mostra o campo apenas quando outro campo
  // tem exatamente o valor indicado (ramificações "Se sim / Se não").
  mostrarSe?: { campo: string; igual: string };
};

export type Categoria = {
  slug: string;
  titulo: string;
  emoji: string;
  prazo: string | null; // SLA exibido ao solicitante. null = sem promessa.
  campos: Campo[];
  // id do campo cujo valor vira o `summary` na fila de triagem.
  resumoDe: string;
  // Spec 059: a pessoa preenche a seção mais de uma vez (vários eventos).
  // Cada repetição vira uma solicitação própria no mesmo protocolo.
  repetivel?: boolean;
  // "+ Adicionar outro <rotuloRepeticao>". Vazio = o título da seção.
  rotuloRepeticao?: string | null;
};

/** Spec 059: quantas vezes a mesma seção entra num envio (o servidor confere). */
export const MAX_REPETICOES = 20;
/**
 * Itens (demandas) num envio -- `MAX_ITENS_POR_LOTE` do servidor. Três seções
 * repetíveis a 20 cada passavam de 60, e a pessoa só descobria no "Enviar".
 */
export const MAX_ITENS_POR_ENVIO = 60;

/**
 * A chave de uma repetição nova da seção. A primeira é o próprio slug (o
 * rascunho e as respostas de antes da Spec 059 continuam valendo); as outras,
 * `slug#n`, com o menor `n` livre -- remover do meio não renumera as que ficam.
 */
export function novaRepeticao(slug: string, existentes: readonly string[]): string {
  if (!existentes.includes(slug)) return slug;
  let n = 2;
  while (existentes.includes(`${slug}#${n}`)) n++;
  return `${slug}#${n}`;
}

/** O nome de cada repetição: "evento", ou o título da seção em minúsculas. */
export function rotuloDaRepeticao(cat: Categoria): string {
  return (cat.rotuloRepeticao || cat.titulo).trim().toLowerCase();
}

/**
 * Um campo condicional está visível para o estado atual de respostas?
 *
 * ⚠️ GATILHO DE MÚLTIPLA ESCOLHA VALE QUANDO A RESPOSTA INCLUI A ALTERNATIVA.
 * O editor e o servidor aceitam `multi` como gatilho; comparar o array com a
 * string dava falso sempre, e a pergunta dependente sumia para sempre.
 *
 * ⚠️ E O GATILHO PRECISA ESTAR VISÍVEL (`campos` = os da seção). Com P1 → P2 →
 * P3, voltar P1 escondia P2 mas deixava P3 na tela, obrigatória e enviada.
 */
export function campoVisivel(
  campo: Campo,
  valores: Record<string, string | string[]>,
  campos: readonly Campo[] = []
): boolean {
  if (!campo.mostrarSe) return true;
  const { campo: idDoGatilho, igual } = campo.mostrarSe;
  const gatilho = campos.find((c) => c.id === idDoGatilho);
  // Sem o próprio campo na lista da volta: um ciclo (que o servidor recusa)
  // não vira recursão infinita.
  const outros = campos.filter((c) => c !== campo);
  if (gatilho && !campoVisivel(gatilho, valores, outros)) return false;
  const dep = valores[idDoGatilho];
  return Array.isArray(dep) ? dep.includes(igual) : dep === igual;
}
