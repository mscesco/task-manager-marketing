/**
 * Regras do modo de edição de colunas: o que oferecer e como traduzir as
 * recusas do backend. Não é segurança; o backend trava de verdade. As recusas
 * são todas 422 e se distinguem pelo `code`, nunca pela mensagem.
 */

import { plural } from "./plural";
import type { Coluna } from "./coluna";

/** Falta escolher para onde vão as tarefas. */
export const CODIGO_SEM_DESTINO = "coluna_sem_destino";
/** O quadro ficaria sem coluna de uma semântica que o sistema escreve. */
export const CODIGO_SEMANTICA_OBRIGATORIA = "coluna_semantica_obrigatoria";

/**
 * Duas colunas do mesmo quadro ficariam com o mesmo nome. A tela já barra
 * antes; chegar aqui é outra pessoa ter renomeado durante a edição.
 */
export const CODIGO_NOME_DE_COLUNA_REPETIDO = "coluna_nome_repetido";

/**
 * Semânticas que o sistema escreve sozinho (toda tarefa nasce em OPEN; a
 * cascata procura DONE), cuja última coluna-alvo não pode sair. Cópia de
 * `SEMANTICAS_QUE_O_SISTEMA_ESCREVE` no `board_service.py`: mude as duas.
 */
const SEMANTICAS_OBRIGATORIAS = ["OPEN", "DONE"] as const;

/** Rótulo da semântica de cada coluna. A semântica é só leitura na tela. */
export const ROTULO_DA_SEMANTICA: Record<string, string> = {
  OPEN: "início",
  IN_PROGRESS: "em andamento",
  DONE: "conclusão",
  CANCELLED: "cancelamento",
};

/** Por que uma coluna nao pode ser apagada. `null` = pode. */
export type ImpedimentoDeExclusao = {
  readonly semantica: Coluna["semantic"];
  /** Texto pronto, para a tela nao montar frase. */
  readonly motivo: string;
};

const NOME_DA_SEMANTICA: Record<string, string> = {
  OPEN: "aberta",
  DONE: "de conclusão",
};

/** `null` se a coluna pode ser apagada; o impedimento, se não. */
export function impedimentoDeExclusao(
  coluna: Coluna,
  todas: readonly Coluna[],
  /** O quadro é o padrão do time; só nele a coluna-ponte é intocável. */
  quadroPadrao = false,
): ImpedimentoDeExclusao | null {
  // Espelha `BoardService._assert_ponte_sobrevive`.
  if (quadroPadrao && coluna.is_status_bridge) {
    return {
      semantica: coluna.semantic,
      motivo:
        "Esta coluna é a origem de um status do sistema e não pode ser " +
        "apagada do quadro geral.",
    };
  }
  if (!SEMANTICAS_OBRIGATORIAS.includes(coluna.semantic as "OPEN" | "DONE")) {
    return null;
  }
  // Tem de sobrar um ALVO (`is_default_target`), não qualquer coluna da mesma
  // semântica: sem alvo a criação de tarefa no quadro falha. Espelha
  // `BoardService._assert_semantica_sobrevive`.
  const sobra = todas.some(
    (c) =>
      c.id !== coluna.id &&
      c.semantic === coluna.semantic &&
      c.is_default_target,
  );
  if (sobra) return null;
  return {
    semantica: coluna.semantic,
    motivo:
      `Este quadro precisa de pelo menos uma coluna ${NOME_DA_SEMANTICA[coluna.semantic]}. ` +
      `Crie outra antes de apagar esta.`,
  };
}

/** Se a coluna de destino ENCERRA as tarefas em vez de so move-las. */
export function destinoEhTerminal(destino: Coluna): boolean {
  return destino.semantic === "DONE" || destino.semantic === "CANCELLED";
}

export type AvisoDeExclusao = {
  readonly titulo: string;
  /** Uma linha por consequencia. A tela desenha em lista. */
  readonly linhas: readonly string[];
  /** Muda o tom do botao e o texto dele. */
  readonly terminal: boolean;
  readonly rotuloDoBotao: string;
};

/**
 * O aviso antes de confirmar. Destino terminal conclui ou cancela o lote
 * (cascata, arquivamento, fim dos avisos de prazo), e o texto diz isso.
 * Coluna vazia sem `exigeDestino` não pergunta nada.
 */
export function avisoDeExclusao(params: {
  coluna: Coluna;
  destino: Coluna | null;
  quantas: number;
  /**
   * Pedir destino mesmo com `quantas === 0`. Não afirma que existem tarefas
   * apagadas: a contagem do front só vê as vivas, e o backend exige destino
   * também para as apagadas (a FK é RESTRICT). Por isso o texto é condicional.
   */
  exigeDestino?: boolean;
}): AvisoDeExclusao | null {
  const { coluna, destino, quantas, exigeDestino = false } = params;
  if (quantas === 0 && !exigeDestino) return null;
  // Texto próprio: as apagadas mudam de coluna sem reescrita de status nem
  // cascata, então os textos de baixo ("marcar N como concluídas") mentiriam.
  if (quantas === 0) {
    return {
      titulo: `"${coluna.name}" está vazia — mas pode guardar tarefas apagadas.`,
      linhas: [
        "A tela conta só as tarefas que aparecem. Tarefa apagada continua presa à coluna, e não dá para saber daqui se existe alguma.",
        "Escolha uma coluna mesmo assim. Se não houver nenhuma, nada acontece; se houver, elas mudam de coluna sem voltar a aparecer e sem mudar de estado.",
      ],
      terminal: false,
      rotuloDoBotao: "Apagar coluna",
    };
  }
  if (destino === null) {
    return {
      titulo: `Para onde vão as ${quantas} tarefas de "${coluna.name}"?`,
      linhas: ["Escolha uma coluna de destino para continuar."],
      terminal: false,
      rotuloDoBotao: "Apagar coluna",
    };
  }
  if (destinoEhTerminal(destino)) {
    const verbo = destino.semantic === "DONE" ? "concluídas" : "canceladas";
    return {
      titulo: `Isto vai marcar ${plural(quantas, "tarefa", "tarefas")} como ${verbo}.`,
      linhas: [
        `As tarefas de "${coluna.name}" vão para "${destino.name}".`,
        `As subtarefas delas também serão ${verbo}.`,
        "Os avisos de prazo dessas tarefas param.",
        "Elas entram na fila de arquivamento automático.",
      ],
      terminal: true,
      rotuloDoBotao: `Apagar e marcar como ${verbo}`,
    };
  }
  return {
    titulo: `${plural(quantas, "tarefa vai", "tarefas vão")} para "${destino.name}".`,
    linhas: [`A coluna "${coluna.name}" será apagada.`],
    terminal: false,
    rotuloDoBotao: "Apagar coluna",
  };
}

/**
 * O que dizer quando o número movido pelo `DELETE` não bate com o do aviso
 * (a contagem envelhece entre as chamadas). Avisa nos dois sentidos.
 */
export function mensagemDeDivergencia(
  previsto: number,
  movidas: number,
): string | null {
  if (previsto === movidas) return null;
  return (
    `O aviso falava em ${plural(previsto, "tarefa", "tarefas")}, ` +
    `mas ${plural(movidas, "foi movida", "foram movidas")}. ` +
    `Alguém mexeu no quadro enquanto você confirmava.`
  );
}

/**
 * Traduz a recusa do backend pelo `code`. Código desconhecido devolve `null`
 * e a tela mostra a mensagem do backend.
 */
export function explicaRecusa(codigo: string | undefined): string | null {
  if (codigo === CODIGO_SEM_DESTINO) {
    return "Escolha para qual coluna as tarefas devem ir.";
  }
  if (codigo === CODIGO_SEMANTICA_OBRIGATORIA) {
    return (
      "Este quadro ficaria sem uma coluna que o sistema precisa para " +
      "criar e concluir tarefas. Crie outra antes de apagar esta."
    );
  }
  if (codigo === CODIGO_NOME_DE_COLUNA_REPETIDO) {
    return (
      "Alguém renomeou uma coluna deste quadro enquanto você editava, e " +
      "dois nomes ficariam iguais. Saia e entre de novo no modo de edição " +
      "para ver como o quadro está agora."
    );
  }
  return null;
}
