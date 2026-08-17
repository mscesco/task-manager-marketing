/**
 * Spec 036, fatia 5b-6 -- as decisoes do modo de EDICAO DE COLUNAS.
 *
 * FRONTEIRA (Spec 027): decisao mora em `lib/`, pura e testada isolada. A tela
 * desenha. Mesmo remedio de `permissoesMembros.ts` e `seletorDeQuadro.ts`.
 *
 * ⚠️ ISTO NAO E SEGURANCA NEM INTEGRIDADE. O backend trava de verdade
 * (`BoardService._assert_semantica_sobrevive` e `_assert_quadro_editavel`), e
 * as recusas dele chegam como 422 com codigo proprio. O que este modulo faz e
 * NAO OFERECER o botao que o servidor vai recusar -- e, quando ele recusar
 * assim mesmo (a tela pode estar com dado velho), traduzir o codigo em algo
 * que explique.
 *
 * ⚠️ AS DUAS RECUSAS SAO 422 E A TELA REAGE DIFERENTE A CADA UMA. Distingui-las
 * pela MENSAGEM acoplaria o produto ao texto do backend -- corrigir uma
 * virgula no aviso quebraria a tela em silencio. Por isso os codigos.
 */

import type { Coluna } from "./coluna";

/** Falta escolher para onde vao as tarefas (ADR 0042 D5). */
// ⚠️ CONTINUA EXPORTADA de proposito, mesmo sem leitor de produção depois que
// o `EditorDeColunas` sumiu (13/08). Ela e METADE DE UM CONTRATO com o
// backend: `explicaRecusa` a usa aqui dentro, e o teste dela e o unico lugar
// que amarra este texto ao `code` que o servidor manda. Sem o export, aquele
// teste deixaria de existir e a traducao poderia divergir do backend em
// silencio.
export const CODIGO_SEM_DESTINO = "coluna_sem_destino";
/** O quadro ficaria sem coluna de uma semantica que o sistema escreve (D4). */
export const CODIGO_SEMANTICA_OBRIGATORIA = "coluna_semantica_obrigatoria";

/**
 * Duas colunas do mesmo quadro ficariam com o mesmo nome (fatia 9, 18/08).
 *
 * ⚠️ ESTE E O UNICO DOS TRES QUE A TELA CONSEGUE PREVER, e ela preve:
 * `nomeRepetidoNoRascunho` barra antes de mandar. Chegar aqui significa que a
 * previsao falhou -- outra pessoa renomeou uma coluna deste quadro enquanto
 * esta edicao estava aberta -- e ai a mensagem tem de dizer isso, e nao
 * repetir "escolha outro nome" como se fosse erro de digitacao.
 */
export const CODIGO_NOME_DE_COLUNA_REPETIDO = "coluna_nome_repetido";

/**
 * As semanticas que o SISTEMA escreve sozinho, e cuja ultima coluna nao pode
 * ser apagada.
 *
 * ⚠️ NAO E "UMA POR SEMANTICA", e confundir isso e o defeito classico aqui.
 * `OPEN` porque toda tarefa nasce em `BACKLOG`; `DONE` porque a cascata de
 * conclusao a procura. `IN_PROGRESS` e `CANCELLED` so recebem tarefa quando
 * uma PESSOA pede -- e ela leva 422 no ato, erro visivel para quem clicou. As
 * outras duas quebrariam em silencio, semanas depois, para outra pessoa.
 *
 * ⚠️ COPIA DELIBERADA de `SEMANTICAS_QUE_O_SISTEMA_ESCREVE` no
 * `board_service.py`. Duas listas, e quem mexer numa tem de justificar por que
 * nao mexeu na outra -- o preco de a tela nao oferecer um botao que o servidor
 * recusa.
 */
const SEMANTICAS_OBRIGATORIAS = ["OPEN", "DONE"] as const;

/**
 * O rotulo da semantica, para a pessoa VER que tipo de coluna e cada uma.
 *
 * ⚠️ ELA ERA INVISIVEL NA TELA ATE 12/08, e a pergunta que revelou isso foi
 * "como eu edito se ela e de conclusao, em progresso, final ou inicio?". Sem o
 * rotulo, a lista mostra oito nomes iguais e uma delas, sem explicacao, nao
 * pode ser apagada -- e nao ha como saber por que aquela e nao outra.
 *
 * ⚠️ E ELA NAO SE EDITA, DE PROPOSITO (`BoardColumnRenameRequest` so aceita
 * `name`). A semantica decide cascata de conclusao, varredura de arquivamento,
 * proporcao da checklist e aviso de prazo -- os quatro em silencio. Troca-la
 * numa coluna com tarefas dentro mudaria o significado das tarefas sem tocar
 * em nenhuma delas e sem uma linha de historico. Mostrar sem deixar editar e a
 * escolha honesta: a pessoa entende o quadro, e nada muda sem aviso.
 */
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

/**
 * `null` se a coluna pode ser apagada; o impedimento, se nao.
 *
 * ⚠️ A PERGUNTA E "SOBRA OUTRA DA MESMA SEMANTICA?", e nao "esta coluna e
 * importante?". Um quadro com duas colunas `DONE` pode perder uma; um com uma
 * so, nao. E um quadro de DUAS colunas (`Backlog` + `Concluído`) e valido --
 * apagar `Em Andamento` e `Cancelado` passa.
 */
export function impedimentoDeExclusao(
  coluna: Coluna,
  todas: readonly Coluna[],
  /**
   * O quadro que contem esta coluna e o PADRAO do time (`board.is_default`).
   *
   * ⚠️ ESTA E A METADE QUE FALTAVA DA TRAVA DA PONTE, e ela nao mora na
   * coluna: mora no quadro, e ja viaja em `BoardResponse`. Combinar as duas
   * aqui e o que impede o erro obvio -- esconder o "x" das quatro colunas base
   * de todo quadro avulso, que TAMBEM tem ponte e PODEM ser apagadas.
   *
   * ⚠️ `false` POR PADRAO, e o default e deliberado: quadro avulso e o caso
   * comum, e esquecer o argumento nao pode virar "sumiu o botao de apagar".
   * O caminho perigoso e o que exige ser escrito.
   */
  quadroPadrao = false,
): ImpedimentoDeExclusao | null {
  // ⚠️ A PONTE VEM PRIMEIRO PORQUE ELA E ABSOLUTA. Os outros impedimentos
  // somem quando o quadro ganha outra coluna da mesma semantica; este nao some
  // com nada que a pessoa possa fazer na tela -- so a 5c, dando degrau de
  // semantica a `default_board_and_column_for_status`, o remove.
  //
  // ⚠️ ESPELHA `BoardService._assert_ponte_sobrevive` (`quadro.is_default AND
  // legacy_status is not None`). Quem mexer numa tem de mexer na outra.
  //
  // ⚠️ O CUSTO DE NAO TER ISTO FOI MEDIDO NA CONFERENCIA DE 17/08: com a
  // 6a-bis abrindo a edicao do Quadro geral, as OITO colunas dele ganhariam um
  // "x" -- e os oito derrubariam o lote inteiro no "Concluir edicao", porque
  // as oito sao ponte. Lixeira que nao funciona e lixeira em que alguem clica.
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
  // ⚠️ O QUE TEM DE SOBRAR E UM **ALVO** (`is_default_target`), e nao uma
  // coluna qualquer daquela semantica. Coluna criada por gente nasce SEMPRE
  // com `is_default_target: false`; conferir so a semantica deixaria a tela
  // oferecer "Apagar" no `Backlog` assim que alguem criasse uma segunda coluna
  // de inicio -- e o backend recusaria com 422 depois do clique. Pior: se
  // passasse, o quadro ficaria com coluna de inicio e SEM ALVO de inicio, e o
  // degrau 2 da ADR 0042 procura exatamente o alvo. Toda criacao de tarefa
  // naquele quadro passaria a falhar, dias depois, para outra pessoa.
  //
  // ⚠️ ESPELHA `BoardService._assert_semantica_sobrevive`. Quem mexer numa tem
  // de mexer na outra.
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
 * O aviso que a pessoa le ANTES de confirmar.
 *
 * ⚠️ DESTINO TERMINAL NAO E MOVER -- E CONCLUIR OU CANCELAR O LOTE, e o texto
 * TEM de dizer isso. Mandar 12 tarefas para `Concluído` dispara cascata de
 * subtarefas, liga `terminal_since` (o relogio do arquivamento) e mata os
 * avisos de prazo delas. Uma pessoa que le "as 12 tarefas vão para Concluído"
 * entende que esta arrumando o quadro; o que ela esta fazendo e encerrar 12
 * trabalhos.
 *
 * ⚠️ SEM CONFIRMACAO DIGITADA, e isso e proporcionalidade e nao descuido.
 * Digitar o nome e a fricção de perda IRREVERSIVEL -- apagar quadro perde
 * comentarios, historico, subtarefas e designacoes, e nao ha tela de
 * restaurar. Aqui nada se perde: as tarefas mudam de coluna e cada uma gera
 * linha em `task_history`. Usar a mesma fricção nos dois ensina que ela nao
 * significa nada, e aí ela para de funcionar onde importa.
 *
 * ⚠️ COLUNA VAZIA NAO PERGUNTA NADA. `quantas === 0` some sem aviso -- e o que
 * o backend faz, e inventar uma confirmacao aqui seria a tela sendo mais
 * cerimoniosa que a operacao.
 */
export function avisoDeExclusao(params: {
  coluna: Coluna;
  destino: Coluna | null;
  quantas: number;
  /**
   * Pedir destino mesmo com `quantas === 0`.
   *
   * ⚠️ ATENCAO AO QUE ESTE PARAMETRO **NAO** DIZ: ele nao afirma que existem
   * tarefas apagadas. Ele diz "pergunte o destino de qualquer forma". A
   * diferenca deixou de ser academica em 17/08, quando a conferencia visual
   * pegou a tela anunciando "guarda tarefas apagadas" num quadro criado cinco
   * minutos antes, onde tarefa nenhuma jamais existiu.
   *
   * ⚠️ POR QUE A CONFUSAO ACONTECEU. No painel antigo (`EditorDeColunas`, que
   * nao existe mais) este parametro so ficava `true` DEPOIS de o backend
   * recusar por falta de destino -- era um fato MEDIDO, e o texto podia
   * afirmar. Na revisao em lote ele e cravado `true` para toda coluna marcada,
   * porque o modelo e perguntar sempre: e o que conserta o beco sem saida por
   * construcao, em vez de descobri-lo no 422. **O parametro sobreviveu com o
   * mesmo nome e o texto continuou afirmando um fato que ninguem mediu.**
   *
   * ⚠️ E O FRONT NAO TEM COMO SABER. A contagem que ele le
   * (`GET .../columns/{id}`) conta so as tarefas VIVAS, de proposito -- tarefa
   * apagada nao existe para quem olha. Ja `BoardService` exige destino se
   * houver vivas **ou** apagadas, porque a FK `task_board_column` e `RESTRICT`
   * e a linha soft-deleted continua apontando para a coluna. Os dois estao
   * certos; o que faltava era a tela falar no CONDICIONAL.
   */
  exigeDestino?: boolean;
}): AvisoDeExclusao | null {
  const { coluna, destino, quantas, exigeDestino = false } = params;
  if (quantas === 0 && !exigeDestino) return null;
  // ⚠️ O CASO DA COLUNA VAZIA TEM TEXTO PROPRIO, E NAO REAPROVEITA OS DE BAIXO.
  // Aqueles falam de "as N tarefas", e aqui N e ZERO para quem olha. Pior:
  // o ramo de destino TERMINAL diria "isto vai marcar 0 tarefas como
  // concluidas", que e falso duas vezes -- nao sao 0 linhas, e elas NAO sao
  // concluidas. As apagadas vao por `UPDATE` direto, sem reescrita de status,
  // sem cascata e sem `task_history`: a linha nao existe para o produto.
  //
  // ⚠️ TUDO AQUI E CONDICIONAL, e a escolha das palavras e a correcao de
  // 17/08. "Guarda tarefas apagadas" era uma afirmacao; "pode guardar" e o que
  // o codigo realmente sabe. O caso comum -- quadro novo, coluna que nunca
  // teve tarefa -- precisa ler como "escolha e siga", e nao como "existe algo
  // escondido aqui que voce nao esta vendo".
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
      titulo: `Isto vai marcar ${quantas} ${plural(quantas, "tarefa", "tarefas")} como ${verbo}.`,
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
    titulo: `${quantas} ${plural(quantas, "tarefa vai", "tarefas vão")} para "${destino.name}".`,
    linhas: [`A coluna "${coluna.name}" será apagada.`],
    terminal: false,
    rotuloDoBotao: "Apagar coluna",
  };
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}

/**
 * O que dizer quando o numero movido NAO bate com o do aviso.
 *
 * ⚠️ O NUMERO QUE VALE E O DO `DELETE`, e nao o do aviso. A contagem envelhece
 * entre as duas chamadas: alguem pode mover uma tarefa para ca no meio.
 *
 * ⚠️ AVISA NOS DOIS SENTIDOS, de proposito. A tela tem dois numeros e nao o
 * motivo -- nao da para saber se entrou ou saiu tarefa. Calar quando moveu
 * MENOS seria o caso inofensivo; calar quando moveu MAIS esconderia um lote
 * maior que o aprovado. Como nao da para distinguir, avisa sempre: o custo de
 * um aviso desnecessario e menor que o de silenciar o outro caso.
 *
 * ⚠️ "Dois numeros discordando sobre a mesma coisa e pior que um numero velho"
 * -- item 17 da conferencia visual do `plan.md` (era o item 10 do
 * `plan-fatia-5.md`, absorvido e RENUMERADO em 13/08; arquivo apagado em 17/08).
 */
export function mensagemDeDivergencia(
  previsto: number,
  movidas: number,
): string | null {
  if (previsto === movidas) return null;
  return (
    `O aviso falava em ${previsto} ${plural(previsto, "tarefa", "tarefas")}, ` +
    `mas ${movidas} ${plural(movidas, "foi movida", "foram movidas")}. ` +
    `Alguém mexeu no quadro enquanto você confirmava.`
  );
}

/**
 * Traduz a recusa do backend em algo que a pessoa entenda.
 *
 * ⚠️ LE O `code`, E NUNCA A MENSAGEM. As duas recusas de apagar coluna sao
 * 422; so o codigo as separa. Comparar texto acoplaria a tela ao portugues do
 * backend, e uma vírgula corrigida la quebraria o produto em silencio.
 *
 * ⚠️ CODIGO DESCONHECIDO DEVOLVE `null`, e a tela mostra a mensagem do
 * backend. Inventar um texto proprio para erro que nao previmos esconderia a
 * causa de quem esta olhando.
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
    // ⚠️ O TEXTO DIZ "ALGUEM MEXEU", e nao "escolha outro nome". A tela ja
    // barra o nome repetido antes de mandar (`nomeRepetidoNoRascunho`), entao
    // este codigo so chega aqui quando a previsao ficou velha: outra pessoa
    // renomeou uma coluna deste quadro depois de esta edicao ter comecado.
    // Mandar a pessoa "escolher outro nome" a faria procurar erro na propria
    // digitacao, que esta certa.
    return (
      "Alguém renomeou uma coluna deste quadro enquanto você editava, e " +
      "dois nomes ficariam iguais. Saia e entre de novo no modo de edição " +
      "para ver como o quadro está agora."
    );
  }
  return null;
}
