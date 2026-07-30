// web/lib/criacaoSubtarefa.ts
// =====================================================================
// Regras da criacao rapida de subtarefa (29/07).
//
// O PROBLEMA, MEDIDO
// Consulta no banco de producao em 29/07, tarefas ativas sem NENHUM
// responsavel:
//
//   subtarefa    BACKLOG        26
//   subtarefa    COMPLETED      15   <- alguem fez, e nao se sabe quem
//   subtarefa    IN_PROGRESS     2
//   subtarefa    PLANNED         1
//   tarefa raiz  (todas)          6
//
// 44 de 50 sao subtarefas -- 88%. E nao e descuido das pessoas: o campo de
// criacao rapida aceitava SO o titulo, entao designar alguem exigia criar,
// abrir e editar. O atalho que a equipe encontrou foi designar todo mundo na
// TAREFA-MAE (ha cards com treze responsaveis), o que desmonta a leitura de
// quem faz o que -- justamente a metrica usada para medir carga.
//
// As 15 concluidas sem responsavel sao o custo ja pago: aquele trabalho nao
// entra na contagem por pessoa de ninguem.
//
// A REGRA
// Responsavel obrigatorio; prazo opcional. Prazo em branco e uma decisao
// legitima ("faz quando der"); responsavel em branco nunca e -- alguem vai
// ter que fazer, e se ninguem sabe quem, a subtarefa nao esta pronta pra
// existir.
//
// A trava vive no FRONT, nao no backend. O endpoint segue aceitando criar sem
// responsavel de proposito: exigir no `POST /tasks` travaria automacao pelo
// n8n e a triagem de solicitacao (que hoje so marca `task_ref` e depende de
// alguem criar a tarefa a mao). Trava de front e reversivel e nao fecha porta.
// =====================================================================

export type RascunhoSubtarefa = {
  titulo: string;
  assigneeIds: string[];
  dueDate: string; // "" = sem prazo
};

export const RASCUNHO_VAZIO: RascunhoSubtarefa = {
  titulo: "",
  assigneeIds: [],
  dueDate: "",
};

/** Motivo pelo qual ainda nao da pra criar. `null` = pode criar. */
export function motivoNaoCria(r: RascunhoSubtarefa): string | null {
  if (!r.titulo.trim()) return "Escreva o titulo da subtarefa.";
  if (r.assigneeIds.length === 0) return "Escolha quem vai fazer.";
  return null;
}

export function podeCriar(r: RascunhoSubtarefa): boolean {
  return motivoNaoCria(r) === null;
}

/**
 * O que o Enter no campo de TITULO deve fazer.
 *
 * Nao e detalhe de teclado: e a mesma armadilha que criava tarefa sem
 * responsavel no TaskModal. Com titulo preenchido e ninguem escolhido, o
 * Enter tem de LEVAR AO SELETOR -- criar seria repetir o bug, e nao fazer
 * nada deixaria a pessoa presa sem entender por que.
 *
 *   "criar"     -> titulo e responsavel prontos
 *   "escolher"  -> titulo pronto, falta responsavel
 *   "nada"      -> titulo vazio (nada a fazer ainda)
 */
export type AcaoDoEnter = "criar" | "escolher" | "nada";

export function acaoDoEnterNoTitulo(r: RascunhoSubtarefa): AcaoDoEnter {
  if (!r.titulo.trim()) return "nada";
  if (r.assigneeIds.length === 0) return "escolher";
  return "criar";
}

/**
 * Alterna uma pessoa na selecao.
 *
 * Multiplos responsaveis sao permitidos -- o modelo suporta e a tarefa mae
 * tambem. Mas o fluxo rapido e otimizado para UM: escolher a primeira ja
 * libera o botao. Quem precisa de mais clica de novo.
 */
export function alternaResponsavel(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Rotulo do botao/resumo da selecao. */
export function resumoResponsaveis(
  ids: readonly string[],
  nomePor: (id: string) => string | undefined
): string {
  if (ids.length === 0) return "Atribuir";
  if (ids.length === 1) return nomePor(ids[0]) ?? "1 pessoa";
  return `${ids.length} pessoas`;
}
