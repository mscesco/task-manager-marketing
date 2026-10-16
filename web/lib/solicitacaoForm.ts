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

/** Um campo condicional está visível para o estado atual de respostas? */
export function campoVisivel(
  campo: Campo,
  valores: Record<string, string | string[]>
): boolean {
  if (!campo.mostrarSe) return true;
  const dep = valores[campo.mostrarSe.campo];
  return dep === campo.mostrarSe.igual;
}
