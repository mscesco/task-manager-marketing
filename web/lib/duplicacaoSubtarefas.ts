/**
 * Passo 2 da duplicação: quem responde por cada subtarefa copiada. Nenhuma
 * nasce sem responsável: quando o original não pode assumir (desativado ou
 * sem alcance no destino), quem duplica escolhe outro ou deixa a subtarefa de
 * fora.
 */

/** Subtarefa da origem, no mínimo que o passo 2 precisa. */
export type FilhaDaOrigem = {
  id: string;
  title: string;
  is_archived?: boolean;
  assignee_ids?: string[];
};

/** Por que a linha está pendente; cada motivo tem sua frase na tela. */
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
 * Classifica as filhas diretas da origem contra quem pode assumir. Arquivada
 * não é copiada e fica de fora. `permitidos` é lista positiva: quem sumiu da
 * lista de membros (ex.: desativado) simplesmente não está nela.
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
 * O passo 2 aparece? Só quando alguma linha nasce pendente. Não olha escolhas
 * nem puladas, para a linha não sumir embaixo do cursor depois de resolvida.
 */
export function haPendencias(linhas: readonly LinhaDeSubtarefa[]): boolean {
  return linhas.some((l) => l.pendente !== null);
}

/** Por que o botão de duplicar está travado, ou `null` se pode seguir. */
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
 * Monta as duas chaves do `POST /tasks/{id}/duplicate`. Nunca manda lista
 * vazia (o backend recusa). Pulada ganha de escolha. Linha sem escolha
 * explícita não entra: ausência = herda os responsáveis.
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
