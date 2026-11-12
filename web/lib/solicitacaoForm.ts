// Os tipos do formulário de solicitação (os dados vêm do banco) e a regra de
// campo condicional.

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
  // A pessoa preenche a seção mais de uma vez; cada repetição vira uma
  // solicitação própria no mesmo protocolo.
  repetivel?: boolean;
  // "+ Adicionar outro <rotuloRepeticao>". Vazio = o título da seção.
  rotuloRepeticao?: string | null;
};

/** Quantas vezes a mesma seção entra num envio (o servidor confere). */
export const MAX_REPETICOES = 20;
/** Itens (demandas) num envio -- `MAX_ITENS_POR_LOTE` do servidor. */
export const MAX_ITENS_POR_ENVIO = 60;

/**
 * A chave de uma repetição nova da seção. A primeira é o próprio slug (o
 * rascunho antigo continua valendo); as outras,
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
 * Gatilho de múltipla escolha vale quando a resposta inclui a alternativa. E o
 * gatilho precisa estar visível (`campos` = os da seção), para a cadeia
 * P1 → P2 → P3 esconder P3 junto com P2.
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
