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
};

/** Um campo condicional está visível para o estado atual de respostas? */
export function campoVisivel(
  campo: Campo,
  valores: Record<string, string | string[]>
): boolean {
  if (!campo.mostrarSe) return true;
  const dep = valores[campo.mostrarSe.campo];
  return dep === campo.mostrarSe.igual;
}
