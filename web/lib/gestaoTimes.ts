// web/lib/gestaoTimes.ts
// =====================================================================
// Regras da tela de gestao de times (Spec 029, Fatia 4).
//
// Fronteira da Spec 027: `lib/` decide, `components/` e `app/` desenham. O
// JSX nao carrega `if` de permissao nem monta mensagem de bloqueio -- ele
// pergunta aqui e desenha a resposta.
//
// ⚠️ NADA AQUI AUTORIZA COISA ALGUMA. Estas funcoes escondem botao que nao
// vai funcionar; quem decide de verdade e o backend, no clique. Duas razoes:
// as contagens envelhecem entre carregar a tela e apertar o botao (medido em
// 29/07: um subtime foi de 0 para 2 membros em vinte minutos), e permissao
// checada no cliente e sugestao, nao trava.
// =====================================================================

/** O que aponta para um time. Vem em lote no GET /current/teams. */
export type ContagensTime = {
  tarefas: number;
  projetos: number;
  membros: number;
  filhos: number;
};

export type TimeGerenciavel = ContagensTime & {
  id: string;
  name: string;
  slug: string;
  parent_team_id: string | null;
  /** Spec 051, fatia D: o servidor diz se quem olha APAGA este time. */
  can_delete?: boolean;
};

/** Raiz = sem pai. E a ancora do tenant: nao se edita nem se remove (D5). */
export function ehRaiz(time: { parent_team_id: string | null }): boolean {
  return time.parent_team_id === null;
}

/** Zero em tudo. Unico estado em que o backend aceita o DELETE (D3-A). */
export function estaVazio(c: ContagensTime): boolean {
  return !(c.tarefas || c.projetos || c.membros || c.filhos);
}

/**
 * Pode editar este time? O SERVIDOR responde, por time (Spec 049, fatia F).
 *
 * ⚠️⚠️ ATE A FATIA F ESTA FUNCAO OLHAVA A PERMISSAO (`subteam.update`), e isso
 * so dava certo porque quem a tinha editava a arvore inteira. Com o
 * SUPERVISOR editando SO o proprio subtime, a mesma linha desenharia o lapis
 * em todos os subtimes, e todos menos um dariam 403 -- a tela nao sabe "onde".
 * Agora ela le `can_update`, que a listagem calcula com a mesma pergunta do
 * PATCH (mesma regra do cadeado do vinculo, Spec 047 §3.1).
 *
 * ⚠️ AUSENTE E "NAO". `can_update` so vem da listagem de times; um `Team` de
 * outra origem nao abre lapis por engano.
 */
export function podeEditar(time: {
  parent_team_id: string | null;
  can_update?: boolean;
}): boolean {
  if (ehRaiz(time)) return false;
  return time.can_update === true;
}

/**
 * Pode APAGAR este time? O SERVIDOR responde, por time (Spec 051, fatia D).
 *
 * ⚠️⚠️ ATE A FATIA D ESTA PERGUNTA ERA `permissoes.includes("subteam.delete")`
 * -- e so dava certo porque o verbo era do ADMIN, que apaga em qualquer arvore.
 * O gerente passou a apagar subtime da PROPRIA arvore (decisao 4, 16/09); com a
 * pergunta "em algum lugar", a lixeira apareceria em todo subtime do workspace
 * e todos os de outra arvore dariam 403. Mesma virada do `podeEditar`.
 *
 * ⚠️ AUSENTE E "NAO": `can_delete` so vem da listagem de times.
 */
export function podeApagarTime(time: {
  parent_team_id: string | null;
  can_delete?: boolean;
}): boolean {
  if (ehRaiz(time)) return false;
  return time.can_delete === true;
}

/**
 * Da para esvaziar e remover? (D3-B)
 *
 * Aqui o time PODE ter conteudo -- ele sera
 * movido para a raiz e arquivado. O que ainda bloqueia e ser a raiz, nao ter
 * permissao, ou ter subtime filho (o filho tem de sair antes, senao a FK
 * `fk_team_parent` recusaria).
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
    // ⚠️ Spec 051: nao e mais "so administrador" -- o gerente apaga na arvore
    // dele. A frase diz o que vale para os dois casos.
    return "Você não remove times nesta área.";
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
  ];
  return partes
    .filter(([n]) => n > 0)
    .map(([n, sing, plur]) => `${n} ${n === 1 ? sing : plur}`)
    .join(", ");
}

/**
 * A confirmacao por digitacao (D2) — exigida SEMPRE, inclusive em time vazio.
 *
 * Tolerante ao que nao muda a intencao (espaco nas pontas, caixa) e rigorosa
 * no resto. Um clique nao apaga um departamento; um "copy" com C maiusculo
 * tambem nao deveria travar quem sabe o que esta fazendo.
 */
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
