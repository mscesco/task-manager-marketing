/**
 * Passo 2 da duplicação: quem responde por cada subtarefa (ADR 0031).
 *
 * FRONTEIRA (Spec 027): isto é DECISÃO -> mora em `lib/`, puro, sem React.
 *
 * ⚠️ POR QUE ESTA CAMADA EXISTE SEPARADA, e não dentro do `TaskModal`. Aquele
 * componente produziu TRÊS regressões em produção numa única sessão, todas
 * envolvendo dados que chegam da rede DEPOIS de o modal abrir (`membros`,
 * `alcancamTime`, `filhosDaOrigem` com referência nova a cada render do pai).
 * O passo 2 acrescenta exatamente mais dessa matéria-prima. Aqui as regras
 * são testadas sem React, sem rede e sem timing; lá sobra desenhar.
 *
 * A regra que o passo 2 serve: **nenhuma subtarefa copiada nasce sem
 * responsável** (ADR 0031). Quando o responsável original não pode assumir a
 * cópia — desativado, ou sem alcance no destino — quem clicou escolhe outro
 * ou tira a subtarefa da cópia. Não existe terceira saída.
 */

/** Subtarefa da origem, no mínimo que o passo 2 precisa. */
export type FilhaDaOrigem = {
  id: string;
  title: string;
  is_archived?: boolean;
  assignee_ids?: string[];
};

/**
 * Por que a linha está pendente.
 *
 * A distinção não é cosmética: "ninguém respondia por ela desde antes" e "o
 * responsável não pode mais" pedem frases diferentes na tela, e a segunda é a
 * que a pessoa não tem como adivinhar sozinha.
 */
export type MotivoPendencia = "sem-responsavel" | "responsaveis-invalidos";

export type LinhaDeSubtarefa = {
  id: string;
  title: string;
  /** Responsáveis da origem que PODEM assumir a cópia. */
  herdados: string[];
  /** Os que ficaram pelo caminho (inativos / sem alcance no destino). */
  descartados: string[];
  /** `null` = resolvida, nada a perguntar. */
  pendente: MotivoPendencia | null;
};

/**
 * Classifica as filhas DIRETAS da origem contra a lista de quem pode.
 *
 * ⚠️ ARQUIVADA NÃO ENTRA (D10 da Spec 033): ela não é copiada, então perguntar
 * quem responde por ela seria pedir decisão sobre algo que não vai existir.
 *
 * ⚠️ `permitidos` é lista de QUEM PODE, nunca de quem não pode. Regra negativa
 * só exclui quem ela conhece: em 04/08 o responsável DESATIVADO não estava em
 * conjunto nenhum, sobrevivia ao filtro e o salvar dava 422. Quem sumiu da
 * lista de membros simplesmente não está em `permitidos`, e é isso que fecha
 * o buraco.
 */
export function linhasDasSubtarefas(
  filhas: readonly FilhaDaOrigem[],
  permitidos: ReadonlySet<string>
): LinhaDeSubtarefa[] {
  return filhas
    .filter((f) => !f.is_archived)
    .map((f) => {
      const ids = f.assignee_ids ?? [];
      const herdados = ids.filter((id) => permitidos.has(id));
      const descartados = ids.filter((id) => !permitidos.has(id));
      const pendente: MotivoPendencia | null =
        herdados.length > 0
          ? null
          : ids.length === 0
            ? "sem-responsavel"
            : "responsaveis-invalidos";
      return { id: f.id, title: f.title, herdados, descartados, pendente };
    });
}

/**
 * O passo 2 precisa APARECER?
 *
 * Só quando alguma linha nasce pendente. Herdando responsáveis válidos, a
 * pessoa clica e duplica — o passo 2 não pode virar pedágio no caso comum.
 *
 * ⚠️ NÃO olha escolhas nem puladas, e isso é o ponto. Uma versão anterior
 * escondia o bloco assim que não faltava mais nada a decidir — resultado: a
 * pessoa escolhia o responsável e a linha SUMIA embaixo do cursor, sem como
 * revisar ou corrigir. Quem responde "já posso salvar?" é
 * `motivoNaoDuplicar`; esta função responde "há assunto aqui?", e o assunto
 * não deixa de existir por ter sido resolvido.
 */
export function haPendencias(linhas: readonly LinhaDeSubtarefa[]): boolean {
  return linhas.some((l) => l.pendente !== null);
}

/**
 * Por que o botão de duplicar está travado — ou `null` se pode seguir.
 *
 * Espelha `criacaoTarefa.motivoNaoCria`: a tela mostra o motivo, não some com
 * o botão. Botão sumido é a pessoa procurando o que fez de errado.
 */
export function motivoNaoDuplicar(
  linhas: readonly LinhaDeSubtarefa[],
  escolhas: Readonly<Record<string, string[]>>,
  puladas: ReadonlySet<string>
): string | null {
  const faltando = linhas.filter(
    (l) =>
      l.pendente !== null &&
      !puladas.has(l.id) &&
      (escolhas[l.id] ?? []).length === 0
  );
  if (faltando.length === 0) return null;
  return faltando.length === 1
    ? `Escolha quem vai fazer "${faltando[0].title}" ou marque para não levá-la.`
    : `${faltando.length} subtarefas ainda precisam de responsável (ou de ser deixadas de fora).`;
}

/** O que vai no corpo do POST, na forma que o backend espera. */
export type PayloadDasSubtarefas = {
  subtask_assignees: Record<string, string[]>;
  skip_subtasks: string[];
};

/**
 * Monta as duas chaves do `POST /tasks/{id}/duplicate`.
 *
 * ⚠️ NUNCA emite lista vazia. O backend recusa com 422 (e faz bem: lista
 * vazia em `assign_many_or_fail` é no-op silencioso, e a filha nasceria órfã
 * com 200 na resposta). Quem não vai, vai em `skip_subtasks`.
 *
 * ⚠️ PULADA GANHA de escolha. Se a pessoa escolheu alguém e depois marcou
 * "não levar", o que vale é o último gesto — mandar as duas coisas faria o
 * backend recusar por incoerência, e ela não saberia por quê.
 *
 * Linha resolvida e sem escolha explícita NÃO entra: ausência significa
 * "herda como sempre", e é o que mantém o comportamento antigo intacto.
 */
export function payloadDasSubtarefas(
  linhas: readonly LinhaDeSubtarefa[],
  escolhas: Readonly<Record<string, string[]>>,
  puladas: ReadonlySet<string>
): PayloadDasSubtarefas {
  const conhecidas = new Set(linhas.map((l) => l.id));
  const subtask_assignees: Record<string, string[]> = {};
  for (const l of linhas) {
    if (puladas.has(l.id)) continue;
    const escolha = escolhas[l.id] ?? [];
    if (escolha.length > 0) subtask_assignees[l.id] = escolha;
  }
  return {
    subtask_assignees,
    // Filtra contra as linhas: id de subtarefa que não está na lista (por
    // exemplo, arquivada) faria o backend recusar o lote inteiro.
    skip_subtasks: [...puladas].filter((id) => conhecidas.has(id)),
  };
}

/** Frase da linha pendente. Duas causas, duas frases. */
export function textoDaPendencia(linha: LinhaDeSubtarefa): string {
  return linha.pendente === "sem-responsavel"
    ? "Ninguém responde por esta subtarefa."
    : "Quem respondia por ela não pode assumir a cópia.";
}
