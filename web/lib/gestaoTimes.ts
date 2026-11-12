// Regras da tela de gestão de times. Só escondem botão que não vai funcionar;
// quem autoriza é o backend, no clique.

/** O que aponta para um time. Vem em lote no GET /current/teams. */
export type ContagensTime = {
  tarefas: number;
  projetos: number;
  membros: number;
  filhos: number;
  // Também seguram o time no banco.
  quadros?: number;
  formularios?: number;
};

export type TimeGerenciavel = ContagensTime & {
  id: string;
  name: string;
  slug: string;
  parent_team_id: string | null;
  /** O servidor diz se quem olha apaga este time. */
  can_delete?: boolean;
};

/** Raiz = sem pai. E a ancora do tenant: nao se edita nem se remove. */
export function ehRaiz(time: { parent_team_id: string | null }): boolean {
  return time.parent_team_id === null;
}

/** Zero em tudo. Unico estado em que o backend aceita o DELETE. */
export function estaVazio(c: ContagensTime): boolean {
  return !(c.tarefas || c.projetos || c.membros || c.filhos || c.quadros || c.formularios);
}

/** Pode editar este time? Lê `can_update` da listagem; ausente é "não". */
export function podeEditar(time: {
  parent_team_id: string | null;
  can_update?: boolean;
}): boolean {
  if (ehRaiz(time)) return false;
  return time.can_update === true;
}

/** Pode apagar este time? Lê `can_delete` da listagem; ausente é "não". */
export function podeApagarTime(time: {
  parent_team_id: string | null;
  can_delete?: boolean;
}): boolean {
  if (ehRaiz(time)) return false;
  return time.can_delete === true;
}

/**
 * Dá para esvaziar e remover? O conteúdo vai para a raiz; bloqueia ser raiz,
 * não ter permissão ou ter subtime filho (a FK `fk_team_parent` recusaria).
 */
export function podeEsvaziarERemover(time: TimeGerenciavel): boolean {
  if (!podeApagarTime(time)) return false;
  return time.filhos === 0;
}

/**
 * Frase do que vai acontecer, para a tela mostrar antes da confirmacao.
 *
 * Separa vivas de lixeira de proposito: "10 tarefas serao arquivadas" seria
 * mentira quando 7 delas ja estao na lixeira e so trocam de time.
 */
export function resumoDoEsvaziamento(p: {
  tarefas_vivas: number;
  tarefas_na_lixeira: number;
  projetos: number;
  membros: number;
  quadros?: number;
  formularios?: number;
}): string[] {
  const linhas: string[] = [];
  if (p.tarefas_vivas > 0) {
    linhas.push(
      `${p.tarefas_vivas} ${
        p.tarefas_vivas === 1 ? "tarefa será arquivada" : "tarefas serão arquivadas"
      } e movida${p.tarefas_vivas === 1 ? "" : "s"} para o time principal`
    );
  }
  if (p.tarefas_na_lixeira > 0) {
    linhas.push(
      `${p.tarefas_na_lixeira} ${
        p.tarefas_na_lixeira === 1 ? "tarefa excluída" : "tarefas excluídas"
      } ${p.tarefas_na_lixeira === 1 ? "será movida" : "serão movidas"} junto`
    );
  }
  if (p.projetos > 0) {
    linhas.push(
      `${p.projetos} ${p.projetos === 1 ? "projeto irá" : "projetos irão"} para o time principal`
    );
  }
  if (p.membros > 0) {
    linhas.push(
      `${p.membros} ${p.membros === 1 ? "membro irá" : "membros irão"} para o time principal`
    );
  }
  const quadros = p.quadros ?? 0;
  if (quadros > 0) {
    linhas.push(`${quadros} ${quadros === 1 ? "quadro irá" : "quadros irão"} para o time principal`);
  }
  const formularios = p.formularios ?? 0;
  if (formularios > 0) {
    linhas.push(
      `${formularios} ${formularios === 1 ? "formulário irá" : "formulários irão"} para o time principal`
    );
  }
  return linhas;
}

/**
 * Por que o botao de remover esta desabilitado. `null` = nao esta.
 *
 * A ordem importa: o motivo mais estrutural primeiro. Dizer "tem 3 tarefas"
 * para quem nem tem permissao manda a pessoa esvaziar o time a toa.
 */
export function motivoNaoRemove(time: TimeGerenciavel): string | null {
  if (ehRaiz(time)) return "O time principal não pode ser removido.";
  if (!podeApagarTime(time)) {
    return "Você não remove subtimes neste time.";
  }
  if (estaVazio(time)) return null;
  return `Ainda tem ${descreveConteudo(time)}.`;
}

/**
 * Lista so o que EXISTE, em portugues. Espelha `_descreve` do backend.
 *
 * "3 tarefas, 2 membros" e acionavel; "3 tarefas, 0 projetos, 2 membros,
 * 0 subtimes" faz a pessoa procurar o que importa no meio de zeros.
 *
 * ⚠️ "tarefas" INCLUI as que estao na lixeira. Elas sumiram da tela mas
 * seguram a chave estrangeira, e o banco recusa o DELETE por causa delas.
 * Um numero que nao bate com o quadro e melhor do que um botao que promete
 * e falha.
 */
export function descreveConteudo(c: ContagensTime): string {
  const partes: Array<[number, string, string]> = [
    [c.tarefas, "tarefa", "tarefas"],
    [c.projetos, "projeto", "projetos"],
    [c.membros, "membro", "membros"],
    [c.filhos, "subtime", "subtimes"],
    [c.quadros ?? 0, "quadro", "quadros"],
    [c.formularios ?? 0, "formulário", "formulários"],
  ];
  return partes
    .filter(([n]) => n > 0)
    .map(([n, sing, plur]) => `${n} ${n === 1 ? sing : plur}`)
    .join(", ");
}

/** Confirmação por digitação, sempre exigida; tolera espaço nas pontas e caixa. */
export function confirmacaoValida(digitado: string, nomeDoTime: string): boolean {
  const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
  const alvo = norm(nomeDoTime);
  if (!alvo) return false;
  return norm(digitado) === alvo;
}

/**
 * Sugere um slug a partir do nome, para o formulario de criacao.
 *
 * O backend so aceita `^[a-z0-9-]+$`; sem isto, digitar "CRM e Automação"
 * devolveria 422 e a pessoa teria que adivinhar a regra. A sugestao e
 * editavel -- e palpite, nao imposicao.
 */
export function sugereSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Raiz primeiro, subtimes por nome (pt-BR). Ordem estavel da tela. */
export function ordenaParaTela<T extends { name: string; parent_team_id: string | null }>(
  times: readonly T[]
): T[] {
  return [...times].sort((a, b) => {
    const ra = a.parent_team_id === null ? 0 : 1;
    const rb = b.parent_team_id === null ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}
