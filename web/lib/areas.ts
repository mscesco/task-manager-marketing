/**
 * ÁREA = time raiz. Spec 046, fatia 1.
 *
 * FRONTEIRA (Spec 027): isto é DECISÃO, então mora em `lib/` -- função pura,
 * sem React, sem `fetch`, testável. O `api.ts` chama daqui.
 *
 * ⚠️⚠️ ESTE ARQUIVO EXISTE PARA MATAR UM DEFEITO QUE AINDA NÃO PODE
 * ACONTECER, e é por isso que ele vem ANTES do backend nesta spec.
 *
 * Até aqui o front respondia "qual é a raiz?" com:
 *
 *     teams.find((t) => t.parent_team_id === null)
 *
 * Com uma raiz só, correto. Com três, `find` devolve **a primeira da ordem em
 * que a API respondeu** -- e essa ordem não é contrato de ninguém: nenhum
 * `ORDER BY` a promete, e ela pode mudar por causa de um `VACUUM`.
 *
 * ⚠️ E o valor não é rótulo: é o `team_id` que o `createTask` fixa no corpo.
 * **Tarefa criada no quadro geral nasceria numa área arbitrária** -- talvez a
 * de outro departamento -- sem erro, sem aviso, sem teste vermelho. É o tipo
 * de defeito que só aparece semanas depois, numa conversa do tipo "por que
 * essa tarefa está no quadro do TI?".
 *
 * ⚠️ POR ISSO A AMBIGUIDADE LEVANTA em vez de escolher. Escolher errado grava
 * dado errado, e o dado errado sobrevive ao conserto do código; levantar
 * interrompe uma pessoa que está olhando para a tela e pode decidir. A ADR
 * 0001 do front já mandava fazer isso -- *"QUANDO subtimes existirem, trocar
 * este null por erro duro, senão a herança silenciosa volta"* -- e a troca
 * nunca aconteceu. É esta.
 *
 * ⚠️ ORDEM DE APLICAÇÃO, e ela não é negociável: esta fatia vai ANTES da que
 * derruba o índice `team_unica_raiz_por_workspace` (fatia 2). Invertida, a
 * janela entre as duas é uma janela de tarefas nascendo na área errada em
 * produção.
 */

import type { Team } from "./api";

/**
 * Por que a área é levantada em vez de resolvida.
 *
 * ⚠️ DOIS MOTIVOS, E ELES PEDEM CONVERSAS DIFERENTES: "nenhuma" é workspace
 * quebrado (ou lista que não carregou); "varias" é a tela precisando saber de
 * QUAL área se está falando. Um `catch` que trate os dois igual vai dizer a
 * frase errada em metade dos casos.
 */
export type MotivoDeAreaIndefinida = "nenhuma" | "varias";

export class AreaIndefinidaError extends Error {
  readonly motivo: MotivoDeAreaIndefinida;
  /** Ids das áreas encontradas -- vazio quando `motivo` é "nenhuma". */
  readonly areas: readonly string[];

  constructor(motivo: MotivoDeAreaIndefinida, areas: readonly string[]) {
    super(
      motivo === "nenhuma"
        ? "Não consegui identificar a área: este workspace não tem nenhum time principal."
        : "Este workspace tem mais de uma área, e esta tela ainda não pergunta qual.",
    );
    this.name = "AreaIndefinidaError";
    this.motivo = motivo;
    this.areas = areas;
  }
}

/**
 * As áreas do workspace -- os times sem pai --, em ordem ESTÁVEL.
 *
 * ⚠️ A ORDENAÇÃO POR NOME É O PONTO, e não enfeite. A ordem da API não é
 * contrato; qualquer tela que precise de "a primeira" precisa de um critério
 * que não mude sozinho entre dois carregamentos. `localeCompare` com "pt-BR"
 * pelo mesmo motivo de `listSubteams`: acento não pode jogar "Ártico" para o
 * fim da lista.
 */
export function rootTeams(teams: readonly Team[]): Team[] {
  return teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * A ÚNICA área do workspace. Levanta se não houver exatamente uma.
 *
 * É o que substitui o `find`. Toda tela que ainda pergunta "qual é a raiz?"
 * sem dizer de qual área fala passa por aqui -- e, no dia em que a segunda
 * área existir, para de funcionar em voz alta em vez de escolher no sorteio.
 *
 * ⚠️ QUEM CHAMA ISTO ESTÁ ASSUMINDO QUE SÓ HÁ UMA ÁREA. A saída definitiva
 * não é tratar o erro: é a tela receber a área de fora (pela URL), o que é a
 * fatia 4 desta spec. Até lá, este erro é o marcador de cada lugar que ainda
 * precisa ser convertido -- procure os chamadores para achar a lista.
 */
export function soleRootTeam(teams: readonly Team[]): Team {
  const raizes = rootTeams(teams);
  if (raizes.length === 0) throw new AreaIndefinidaError("nenhuma", []);
  if (raizes.length > 1) {
    throw new AreaIndefinidaError(
      "varias",
      raizes.map((t) => t.id),
    );
  }
  return raizes[0];
}
