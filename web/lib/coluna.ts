// Regras que dependem do significado da coluna (`semantic`, `notify_deadline`).
// Puro: recebe a coluna do `GET /boards` e responde perguntas sobre ela.

import { deadlineDays, DIAS_PARA_PARADA, type DeadlineTone } from "@/lib/status";
import { agoraNoWorkspace, estaAtrasada } from "@/lib/prazo";

// ---------------------------------------------------------------------------
// O CONTRATO
// ---------------------------------------------------------------------------

/**
 * As quatro semanticas do backend (`ColumnSemantic`). DONE e CANCELLED sao
 * terminais mas nao intercambiaveis: a checklist conta concluidas e ignora canceladas.
 */
export type ColumnSemantic = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/** Uma coluna como o `GET /api/v1/boards` a devolve (`BoardColumnResponse`). */
export interface Coluna {
  id: string;
  name: string;
  color: string;
  position: number;
  semantic: ColumnSemantic;
  notify_deadline: boolean;
  is_default_target: boolean;
  /**
   * Esta coluna e ponte de algum status. Sozinho nao significa "nao pode ser
   * apagada": quem decide isso e `impedimentoDeExclusao`.
   */
  is_status_bridge: boolean;
}

// ---------------------------------------------------------------------------
// OS PREDICADOS
// ---------------------------------------------------------------------------

const SEMANTICAS_TERMINAIS: ReadonlySet<ColumnSemantic> = new Set<ColumnSemantic>([
  "DONE",
  "CANCELLED",
]);

/** A semântica é terminal? (Para quando ainda não há `Coluna`, como no formulário de criar.) */
export function semanticaTerminal(semantic: ColumnSemantic): boolean {
  return SEMANTICAS_TERMINAIS.has(semantic);
}

/** A tarefa acabou (concluida ou cancelada) por estar nesta coluna. */
export function terminal(coluna: Coluna): boolean {
  return semanticaTerminal(coluna.semantic);
}

/**
 * As cores que uma coluna criada por gente pode receber. Cópia de
 * `board_service.py::CORES_DE_COLUNA`, na mesma ordem (é a ordem da rotação);
 * o backend recusa cor fora da lista. Token, nunca hex: token inverte no tema escuro.
 */
export const CORES_DE_COLUNA: readonly string[] = [
  "var(--status-backlog-dot)",
  "var(--status-planned-dot)",
  "var(--status-progress-dot)",
  "var(--status-review-dot)",
  "var(--status-external-dot)",
  "var(--status-done-dot)",
  "var(--status-cancel-dot)",
  "var(--status-blocked-dot)",
];

/** Esta coluna cobra prazo? Terminal nunca avisa, independente da flag (`board_semantics.avisa_prazo`). */
export function avisaPrazo(coluna: Coluna): boolean {
  if (terminal(coluna)) return false;
  return coluna.notify_deadline;
}

/**
 * Ficar parado nesta coluna e noticia? Exige `notify_deadline` alem de
 * `IN_PROGRESS`: so a semantica daria o selo ao Bloqueado, que nao deve ter.
 */
export function pararEhNoticia(coluna: Coluna): boolean {
  return coluna.semantic === "IN_PROGRESS" && avisaPrazo(coluna);
}

// ---------------------------------------------------------------------------
// PRAZO, PARADA E AGRUPAMENTO POR COLUNA
// ---------------------------------------------------------------------------

/** Cor de prazo da tarefa, decidida pela coluna. */
export function deadlineTonePorColuna(
  coluna: Coluna,
  dueDate: string | null | undefined,
  isArchived: boolean,
  /** Ausente = tarefa sem hora. */
  dueTime?: string | null
): DeadlineTone {
  if (!dueDate || isArchived) return null;
  if (!avisaPrazo(coluna)) return null;
  // Atraso com hora e um instante; a janela de "vence em 2 dias" e em dias.
  if (estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) return "overdue";
  const dias = deadlineDays(dueDate);
  if (dias <= 2) return "soon";
  return null;
}

/** Dias inteiros desde a ultima mudanca, ou `null` quando nao ha selo (nao 0). */
export function diasParadoPorColuna(
  coluna: Coluna,
  updatedAt: string | null | undefined,
  isArchived: boolean
): number | null {
  if (!updatedAt || isArchived) return null;
  if (!pararEhNoticia(coluna)) return null;
  const t = new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return null; // data suja nao vira selo
  const desde = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dias = Math.round((hoje.getTime() - desde.getTime()) / 86400000);
  if (dias < DIAS_PARA_PARADA) return null;
  return dias;
}

/** Ids das colunas ligadas quando `/minhas-tarefas` abre: todas menos as concluidas (Cancelado aparece). */
export function colunasPadraoMinhasTarefas(colunas: readonly Coluna[]): string[] {
  return colunas.filter((c) => c.semantic !== "DONE").map((c) => c.id);
}

/**
 * A coluna de `destino` equivalente a `coluna`, que pode ser de outro quadro:
 *   1. mesma coluna (`id` igual);
 *   2. senao, a `is_default_target` da mesma semantica;
 *   3. senao, `undefined` (quem chama decide).
 * A ordem importa: invertida, uma tarefa em "Aprovação Externa" cairia em "Em Andamento".
 * Espelha a regra do backend.
 */
export function colunaEquivalente(
  coluna: Coluna,
  destino: readonly Coluna[],
): Coluna | undefined {
  const exata = destino.find((c) => c.id === coluna.id);
  if (exata) return exata;
  return destino.find(
    (c) => c.is_default_target && c.semantic === coluna.semantic,
  );
}

/**
 * De onde vem a coluna de uma tarefa, do ponto de vista da tela que desenha.
 * `nomeDoQuadro = null` = "e o quadro desta tela"; "nao sei" e a ausencia do objeto.
 */
export type OrigemDaColuna = {
  coluna: Coluna;
  nomeDoQuadro: string | null;
};

/**
 * `column_id -> de onde ela vem`, sobre todos os quadros que a pessoa alcanca.
 * `quadroDaTela` e um `board_id`. Tipo estrutural porque `lib/api.ts` importa
 * este modulo (importar `Quadro` de la fecharia ciclo).
 */
export function indiceDeColunas(
  quadros: readonly { id: string; name: string; colunas: readonly Coluna[] }[],
  quadroDaTela: string | null,
): Map<string, OrigemDaColuna> {
  const indice = new Map<string, OrigemDaColuna>();
  for (const q of quadros) {
    const nomeDoQuadro = q.id === quadroDaTela ? null : q.name;
    for (const c of q.colunas) {
      indice.set(c.id, { coluna: c, nomeDoQuadro });
    }
  }
  return indice;
}

/**
 * O rotulo de uma tarefa nas telas que atravessam quadros:
 * `Em Andamento` no quadro da tela; `Campanhas · Em Revisão` em outro;
 * `null` quando a coluna e desconhecida (a reserva por status fica com o chamador).
 */
export function rotuloDeColuna(origem: OrigemDaColuna | undefined): string | null {
  if (origem === undefined) return null;
  return origem.nomeDoQuadro === null
    ? origem.coluna.name
    : `${origem.nomeDoQuadro} · ${origem.coluna.name}`;
}

/**
 * O quadro geral de um time: com varios times raiz existem varios gerais, entao
 * nunca use `find((q) => q.is_default)` sozinho. `teamId` nao aceita `null`:
 * "sem time" tem resposta diferente em cada chamador. Tipo estrutural pelo
 * mesmo motivo de `indiceDeColunas`.
 */
export function quadroGeralDoTime<
  Q extends { readonly is_default: boolean; readonly team_id: string },
>(quadros: readonly Q[], teamId: string): Q | undefined {
  return quadros.find((q) => q.is_default && q.team_id === teamId);
}
