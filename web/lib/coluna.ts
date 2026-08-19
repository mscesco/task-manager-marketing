// lib/coluna.ts
//
// AS REGRAS QUE DEPENDEM DO SIGNIFICADO DA COLUNA (Spec 036, fatia 4a /
// ADR 0040).
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. `lib/status.ts` reimplementa a mao, em tres
// conjuntos de status cravados, o que `column.semantic` e
// `column.notify_deadline` ja dizem -- campos que o backend criou na Spec 035
// e que ate agora nao tinham leitor no front. Aquilo funciona para os 8 status
// legados e SO para eles: coluna criada por gente nasce com `legacy_status`
// NULL (ADR 0033/0036) e cai fora de todos os conjuntos, em silencio -- sem
// erro, sem log, sem teste vermelho.
//
// ⚠️ ESTE MODULO E ADITIVO, DE PROPOSITO. As funcoes por status continuam
// vivas em `lib/status.ts` ate a fatia 4c migrar os quatro call-sites
// (`TaskCard`, `TaskDetail`, `minhas-tarefas`, `Board`). Trocar as assinaturas
// agora deixaria o `tsc` vermelho entre fatias -- entrega parcial que quebra o
// build, que e armadilha catalogada deste repositorio.
//
// ⚠️ E DUAS IMPLEMENTACOES DA MESMA REGRA E EXATAMENTE O DEFEITO QUE ESTE
// ARQUIVO EXISTE PARA MATAR. O que torna a convivencia aceitavel e
// `lib/__tests__/paridadeColuna.test.ts`, que compara as duas caso a caso
// contra as 8 colunas padrao. **Ele morre junto com o bloco antigo, na 4c.**
// Se voce esta lendo isto depois da 4c e o bloco antigo ainda existe, a
// migracao ficou pela metade.
//
// ESTE MODULO E PURO (Spec 027): sem I/O, sem React, sem `window`. Ele recebe
// a coluna que o `GET /boards` devolveu e responde perguntas sobre ela.

import { deadlineDays, DIAS_PARA_PARADA, type DeadlineTone } from "@/lib/status";
import { agoraNoWorkspace, estaAtrasada } from "@/lib/prazo";

// ---------------------------------------------------------------------------
// O CONTRATO
// ---------------------------------------------------------------------------

/**
 * As quatro semanticas do backend (`ColumnSemantic`, ADR 0030).
 *
 * ⚠️ DONE e CANCELLED sao os dois TERMINAIS e NAO sao intercambiaveis: a
 * proporcao da checklist conta concluidas e ignora canceladas.
 */
export type ColumnSemantic = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/**
 * Uma coluna como o `GET /api/v1/boards` a devolve (`BoardColumnResponse`).
 *
 * ⚠️ `legacy_status` NAO ESTA AQUI, e a ausencia e decisao do backend: ele e
 * ponte com data de demolicao (ADR 0033) e o endpoint nao o expoe, para nao
 * convidar o front a se amarrar na ponte em vez de na semantica. Se voce
 * sentiu falta dele para escrever alguma regra, a regra esta errada.
 */
export interface Coluna {
  id: string;
  name: string;
  color: string;
  position: number;
  semantic: ColumnSemantic;
  notify_deadline: boolean;
  is_default_target: boolean;
  /**
   * Esta coluna e ponte de ALGUM status -- sem dizer de qual (17/08).
   *
   * ⚠️ NAO E O `legacy_status` DISFARCADO, e a diferenca e o que mantem a ADR
   * 0033 de pe: com um booleano nao da para mapear status -> coluna, que era o
   * acoplamento a evitar. Ele responde UMA pergunta: o backend recusa apagar
   * esta coluna por causa da ponte?
   *
   * ⚠️⚠️ **SOZINHO ELE NAO SIGNIFICA "NAO PODE SER APAGADA", E CONFUNDIR OS
   * DOIS QUEBRA O QUADRO AVULSO.** As QUATRO colunas base de um quadro avulso
   * tambem nascem com ponte, e elas PODEM ser apagadas -- a conferencia visual
   * item 14 depende disso. A trava do backend
   * (`_assert_ponte_sobrevive`) e `quadro.is_default && is_status_bridge`, com
   * as DUAS metades. **Quem combina as duas e `impedimentoDeExclusao`, e so
   * ela.** Se voce estiver lendo `is_status_bridge` em qualquer outro lugar
   * para decidir se da para apagar, esta escrevendo a segunda copia da regra.
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

/** A tarefa acabou (concluida ou cancelada) por estar nesta coluna. */
export function terminal(coluna: Coluna): boolean {
  return SEMANTICAS_TERMINAIS.has(coluna.semantic);
}

/**
 * Esta coluna cobra prazo?
 *
 * Traducao literal de `board_semantics.avisa_prazo` do backend: terminal nunca
 * avisa, INDEPENDENTE da flag. Nao e redundancia -- deixar a flag decidir o
 * terminal permitiria uma coluna `DONE` que cobra prazo, estado sem
 * significado nenhum e alcancavel por um clique no CRUD de coluna da fatia 5.
 *
 * ⚠️ PARIDADE MEDIDA (ADR 0040) contra as 8 colunas padrao: silencia
 * COMPLETED (DONE), CANCELLED (CANCELLED) e BLOCKED (`IN_PROGRESS` com
 * `notify_deadline = false`) -- exatamente os tres que `deadlineTone` lista a
 * mao hoje, e so eles.
 */
export function avisaPrazo(coluna: Coluna): boolean {
  if (terminal(coluna)) return false;
  return coluna.notify_deadline;
}

/**
 * Ficar parado NESTA coluna e noticia?
 *
 * ⚠️ AQUI MORA A UNICA DECISAO NAO-OBVIA DESTE ARQUIVO, e ela esta registrada
 * na ADR 0040. A traducao ingenua -- `semantic === "IN_PROGRESS"` -- MUDARIA O
 * COMPORTAMENTO: o BLOCKED tem semantica `IN_PROGRESS` e passaria a ganhar o
 * selo "parada ha X dias". A D6 da Spec 031 o excluiu de proposito
 * ("bloqueio e estado declarado, alguem ja sabe").
 *
 * ⚠️ ENTAO ISTO FUNDE DOIS CONCEITOS que nasceram separados: `notify_deadline`
 * significa "cobra prazo", e aqui passa a significar tambem "parar aqui e
 * noticia". A fusao foi aceita porque as duas perguntas sao a mesma vista de
 * dois angulos -- *"a tarefa deveria estar avancando nesta coluna?"*. Quem
 * criar "Aguardando cliente" com a flag desligada nao quer nem alerta de prazo
 * nem selo de parada, e recebe os dois comportamentos certos de uma decisao so.
 *
 * **Se algum dia alguem quiser cobrar prazo SEM rastrear parada, o campo
 * proprio se cria entao, com o caso na mao** -- nao antes.
 */
export function pararEhNoticia(coluna: Coluna): boolean {
  return coluna.semantic === "IN_PROGRESS" && avisaPrazo(coluna);
}

// ---------------------------------------------------------------------------
// AS FUNCOES QUE SUBSTITUEM AS DE `lib/status.ts`
// ---------------------------------------------------------------------------

/**
 * Cor de prazo da tarefa (Spec 023), decidida pela COLUNA.
 *
 * Substitui `status.deadlineTone(dueDate, status, isArchived)`.
 *
 * A aritmetica de data e a MESMA (`deadlineDays`, importada) -- duplicar o
 * calculo aqui criaria duas fontes de verdade para "quantos dias faltam", e as
 * duas divergiriam no primeiro ajuste de fuso.
 */
export function deadlineTonePorColuna(
  coluna: Coluna,
  dueDate: string | null | undefined,
  isArchived: boolean,
  /**
   * Spec 038, fatia B. Ausente = tarefa sem hora, que e o comportamento de
   * sempre.
   *
   * ⚠️ OPCIONAL DE PROPOSITO, e nao por preguica de atualizar chamador: sem
   * hora esta funcao tem de responder EXATAMENTE o que respondia antes desta
   * fatia. Um parametro obrigatorio forcaria todo chamador a decidir algo, e
   * quem passasse `""` mudaria o comportamento sem querer.
   */
  dueTime?: string | null
): DeadlineTone {
  if (!dueDate || isArchived) return null;
  if (!avisaPrazo(coluna)) return null;
  // ⚠️ O ATRASO SAI DE `estaAtrasada`, E O RESTO CONTINUA EM DIAS. Atraso com
  // hora e pergunta sobre um INSTANTE ("venceu as 18:00 e agora sao 18:01"), e
  // dia nao expressa isso -- continua sendo dia zero. Ja a janela de "vence em
  // 2 dias" e os rotulos sao em DIAS de proposito.
  if (estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) return "overdue";
  const dias = deadlineDays(dueDate);
  if (dias <= 2) return "soon";
  return null;
}

/**
 * Dias inteiros desde a ultima mudanca, ou `null` quando nao ha selo.
 *
 * Substitui `status.diasParado(updatedAt, status, isArchived)`.
 *
 * `null` (e nao 0) para "nao se aplica": arquivada, coluna onde parar nao e
 * noticia, ou abaixo do limiar. Quem chama testa `!= null`, sem confundir com
 * "0 dias".
 *
 * ⚠️ O CORPO E COPIA LITERAL do original, trocando so o predicado de entrada.
 * Isso e intencional: qualquer "melhoria" na aritmetica aqui tornaria o teste
 * de paridade incapaz de provar que nada mudou, que e a unica coisa que
 * autoriza as duas implementacoes a coexistirem.
 */
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

/**
 * Colunas ligadas quando `/minhas-tarefas` abre: todas menos as CONCLUIDAS.
 *
 * Substitui `status.statusPadraoMinhasTarefas()`, que devolvia chaves de
 * status; esta devolve os `id` das colunas, que e o que a tela vai filtrar
 * depois da fatia 4b.
 *
 * ⚠️ CANCELADO CONTINUA APARECENDO, e isso e decisao explicita (ADR 0040,
 * item 5). `CANCELLED` tambem e semantica terminal, e esconder as duas seria
 * o comportamento "coerente" -- mas hoje a coluna Cancelado aparece, e mudar
 * isso e decisao de produto disfarcada de refatoracao. Se for para esconder,
 * e outra ADR.
 */
export function colunasPadraoMinhasTarefas(colunas: readonly Coluna[]): string[] {
  return colunas.filter((c) => c.semantic !== "DONE").map((c) => c.id);
}

/**
 * A cor da coluna, pronta para ir num `style`.
 *
 * ⚠️ O CAMPO `color` GUARDA DOIS FORMATOS, e nao e transicao inacabada -- e
 * decisao (ADR 0040, item 4):
 *
 *   - as 8 colunas padrao guardam `"var(--status-backlog-dot)"`, e continuam
 *     assim porque o token INVERTE COM O TEMA. Migra-las para hex pioraria o
 *     que 100% das tarefas de producao usam hoje;
 *   - coluna criada por gente guarda hex (`"#7C3AED"`), escolhido numa roda
 *     RGB. Hex nao inverte com o tema -- e o preco aceito de deixar a pessoa
 *     escolher a cor.
 *
 * ⚠️ ESTA FUNCAO NAO VALIDA NADA. A partir da fatia 5 o valor passa a ser
 * ENTRADA DE USUARIO indo parar num `style`, e **a validacao
 * (`^#[0-9a-fA-F]{6}$`) e do BACKEND**, no CRUD de coluna. Nao confie no
 * `<input type="color">`: o campo e `String(60)` e cabe muita coisa que nao e
 * cor.
 */
export function corDaColuna(coluna: Coluna): string {
  return coluna.color;
}

/**
 * A coluna e hex livre (e portanto NAO inverte com o tema)?
 *
 * Existe para quem precisar derivar contraste do texto por cima: com token
 * ha `--*-text` pareado; com hex nao ha par, e a cor do texto tem de sair da
 * luminancia. Essa derivacao e da fatia 5 -- aqui so se responde a pergunta.
 */
/**
 * A coluna de `destino` equivalente a `coluna`, que pode ser de OUTRO quadro.
 *
 * ⚠️ E A ADR 0042 DO BACKEND, ESCRITA NO FRONT, e os degraus sao os MESMOS:
 *
 *   1. mesma coluna (`id` igual) -> e ela. Cobre 100% das tarefas de hoje, que
 *      vivem todas no Quadro geral;
 *   2. nao achando: a coluna `is_default_target` da MESMA semantica em
 *      `destino`;
 *   3. nao achando nenhuma das duas: `undefined`. Quem chama decide, e a
 *      resposta certa NAO e "a primeira coluna" -- e avisar.
 *
 * ⚠️ A ORDEM E A DECISAO INTEIRA. Invertida, uma tarefa em `Aprovação Externa`
 * do Quadro geral seria desenhada em `Em Andamento`, porque as duas tem
 * semantica `IN_PROGRESS` e so a segunda e alvo. Coluna valida, quadro certo,
 * card no lugar errado -- e `tsc`, `vitest` e `next build` passam.
 *
 * ⚠️ NAO E A MESMA PERGUNTA QUE `colunasDoQuadro`. Aquela responde "quais sao
 * as colunas do quadro X"; esta responde "onde desenho, no quadro X, uma
 * tarefa que vive no quadro Y". A segunda so passou a existir porque
 * `/minhas-tarefas` e `/arquivadas` atravessam quadros por decisao (ADR 0034,
 * item 6) enquanto desenham UM conjunto de colunas.
 *
 * ⚠️ DUAS IMPLEMENTACOES DA MESMA REGRA, e a duplicacao e o preco de o backend
 * nao poder responder por linha numa tela que ja tem a lista em memoria. O que
 * a mantem honesta e `lib/__tests__/colunaEquivalente.test.ts`.
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
 *
 * ⚠️ CARREGA A `Coluna` INTEIRA, e nao o nome dela. A versao anterior desta
 * entrega guardava `nomeDaColuna: string`, e nao servia: as telas transversais
 * precisam de `semantic` e `is_default_target` para AGRUPAR o card
 * (`colunaEquivalente`) e de `notify_deadline` + `semantic` para decidir o
 * alerta de prazo (`deadlineTonePorColuna`). Com so o nome, as duas regras
 * ficariam sem entrada e a tela cairia num segundo indice paralelo -- duas
 * estruturas montadas do mesmo laco, duas consultas por card, e a chance de
 * ter uma sem a outra.
 *
 * ⚠️ `nomeDoQuadro = null` SIGNIFICA "e o quadro desta tela", e nao "nao sei".
 * "Nao sei" e a AUSENCIA deste objeto (`undefined` na consulta ao indice), e
 * nao um valor dentro dele. Sao tres estados e nao dois -- ver
 * `rotuloDeColuna`.
 */
export type OrigemDaColuna = {
  coluna: Coluna;
  nomeDoQuadro: string | null;
};

/**
 * `column_id -> de onde ela vem`, sobre TODOS os quadros que a pessoa alcanca.
 *
 * ⚠️ POR QUE ISTO EXISTE. `/minhas-tarefas` e `/arquivadas` atravessam quadros
 * por decisao (ADR 0034 item 6) enquanto desenham UM conjunto de colunas. O
 * `GET /boards` ja devolve todos os quadros COM as colunas de cada um -- o
 * front nao precisa de requisicao nova, precisa parar de jogar fora o que ja
 * recebe. Antes desta funcao, `colunasDoQuadroGeral` descartava todos os
 * quadros menos o padrao, e a tarefa de quadro avulso ficava sem nome de
 * coluna para mostrar.
 *
 * ⚠️ `quadroDaTela` E UM `board_id`, NAO UM NOME. Nome e editavel desde a
 * fatia 5b-3.
 *
 * ⚠️ A COLUNA CARREGA O NOME DO QUADRO DONO DELA, e nao o do quadro da tela.
 * Dois quadros podem ter coluna com o MESMO nome (`Em Andamento` esta nas 8
 * padrao e nas 4 base, de proposito) -- e e justamente ai que confundir os
 * dois passa despercebido.
 *
 * ⚠️ TIPO ESTRUTURAL, e nao `Quadro` de `lib/api.ts`. Aquele modulo importa
 * ESTE (`lib/api.ts` linha 6); importar de volta fecharia ciclo. O formato
 * abaixo e o subconjunto de `Quadro` que esta regra usa, e o `tsc` aceita um
 * `Quadro` no lugar dele sem conversao.
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
 * O rotulo de uma tarefa nas telas que atravessam quadros.
 *
 * `Em Andamento` quando a tarefa vive no quadro que a tela desenha;
 * `Campanhas · Em Revisão` quando vive em outro;
 * `null` quando a coluna nao veio em quadro nenhum que a pessoa alcanca.
 *
 * ⚠️ AS DUAS INFORMACOES, E NAO SO O QUADRO. O nome do quadro responde "onde
 * mora"; o da coluna responde "por que este card esta agrupado em Em Andamento
 * se a coluna dele chama outra coisa". Sem a segunda metade, tarefa numa
 * coluna criada por gente parece defeito de agrupamento.
 *
 * ⚠️ RECEBE UM OBJETO E DEVOLVE `string | null`, e as duas metades sao de
 * proposito. A versao anterior (5b-5a) era
 * `rotuloDeColuna(nomeDaColuna: string, nomeDoQuadro: string | null): string`,
 * e nela o caso "nao sei qual coluna" -- que e NORMAL em `/arquivadas`, tela
 * que lista o workspace inteiro paginado -- so tinha uma saida: o chamador
 * passar o rotulo do STATUS no parametro chamado `nomeDaColuna`. Os dois sao
 * `string`, entao o `tsc` aceitaria calado, e a tela mostraria um status onde
 * promete uma coluna. Mesma familia do `text()` que devolve string e nao enum:
 * o tipo responde certo em todo lugar e o valor esta errado.
 *
 * Com esta assinatura o desconhecido e `undefined` na ENTRADA e `null` na
 * SAIDA, e nenhum dos dois se parece com um rotulo. **A reserva por status e
 * decisao do chamador** -- `rotuloDeColuna(...) ?? STATUS_LABEL[t.status]` --
 * e o `tsc` obriga cada tela a escrever qual e a dela.
 *
 * ⚠️ ESTE MODULO NAO CONHECE STATUS, e nao deve passar a conhecer. Fazer a
 * reserva aqui exigiria importar a tabela de rotulos de `lib/status.ts`,
 * modulo que a fatia 5b-5b existe para encolher.
 */
export function rotuloDeColuna(origem: OrigemDaColuna | undefined): string | null {
  if (origem === undefined) return null;
  return origem.nomeDoQuadro === null
    ? origem.coluna.name
    : `${origem.nomeDoQuadro} · ${origem.coluna.name}`;
}

export function corEhHex(coluna: Coluna): boolean {
  return coluna.color.startsWith("#");
}
