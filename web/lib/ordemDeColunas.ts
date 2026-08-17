/**
 * A ordem das colunas de um quadro (Spec 036, fatia 6b).
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE SEPARADO DA TELA. `onDragEnd` **nao e
 * testavel em jsdom** -- o produto ja tem dois assim, e a fatia 6 acrescenta o
 * terceiro. Se a regra de "para onde a coluna vai" morar dentro do handler de
 * arraste, ela nasce sem guardiao. Aqui ela e uma funcao pura, e tanto o
 * arraste quanto as setas do teclado a chamam: o caminho testavel exercita a
 * mesma linha que o caminho nao testavel.
 *
 * ⚠️ A ORDEM E VISUAL, E SO. Nenhuma decisao do backend depende de `position`
 * (medido em 13/08: ela so aparece em `ORDER BY` de leitura). O destino da
 * cascata continua sendo a coluna `is_default_target` da semantica, e NAO a
 * primeira pela ordem -- ADR 0030, de proposito, para que arrastar nao mude
 * comportamento em silencio. ⚠️ E por isso que a tela de edicao MOSTRA qual e
 * o alvo: reordenar torna essa confusao provavel.
 */

import type { Coluna } from "@/lib/coluna";

/** As duas direcoes possiveis. O quadro e horizontal. */
export type Direcao = "esquerda" | "direita";

/**
 * A lista com `idMovida` reposicionada em `indiceDestino`.
 *
 * Devolve `null` quando **nada muda** -- e isso e contrato, nao detalhe.
 * Quem chama usa o `null` para nao pintar a tela nem disparar requisicao:
 *
 * ```ts
 * const nova = reordenarColunas(colunas, id, destino);
 * if (nova === null) return;        // nem otimista, nem rede
 * ```
 *
 * ⚠️ SEM O `null`, A SETA NA PONTA VIRA REQUISICAO. Apertar ← na primeira
 * coluna mandaria ao servidor a mesma ordem que ja esta la -- e como o
 * endpoint aceita (a lista e valida), a tela ficaria disparando escrita para
 * cada tecla apertada sem efeito. Devolver a mesma lista tambem "funcionaria",
 * mas obrigaria quem chama a compara-la elemento a elemento para descobrir
 * isso.
 *
 * ⚠️ `indiceDestino` E GRAMPEADO na faixa valida, e nao recusado. No arraste, o
 * cursor passa do fim da lista o tempo todo; recusar transformaria um gesto
 * comum em "nao aconteceu nada". Fora da faixa, a intencao e clara: a ponta.
 *
 * ⚠️ ID DESCONHECIDO DEVOLVE `null`, e nao estoura. A lista da tela pode estar
 * velha (outra pessoa apagou a coluna enquanto esta arrastava). O servidor
 * recusa esse caso com `colunas_divergentes`; aqui, antes disso, o certo e nao
 * fazer nada -- estourar deixaria a tela quebrada por um dado que ja mudou.
 */
export function reordenarColunas(
  colunas: readonly Coluna[],
  idMovida: string,
  indiceDestino: number,
): Coluna[] | null {
  const origem = colunas.findIndex((c) => c.id === idMovida);
  if (origem === -1) return null;

  const destino = Math.min(Math.max(indiceDestino, 0), colunas.length - 1);
  if (destino === origem) return null;

  const nova = [...colunas];
  const [movida] = nova.splice(origem, 1);
  nova.splice(destino, 0, movida);
  return nova;
}

/**
 * A lista com `idMovida` andando UMA casa para o lado.
 *
 * ⚠️ EXISTE PARA AS SETAS, e as setas existem por dois motivos que se somam.
 * O primeiro e acessibilidade: arrastar nao tem equivalente de teclado nem de
 * leitor de tela, e sem elas quem nao usa mouse simplesmente nao reordena. O
 * segundo e teste: este caminho E exercitavel em jsdom, e como ele delega para
 * `reordenarColunas`, prende a mesma regra que o arraste usa.
 *
 * ⚠️ "esquerda" E MENOS UM PORQUE O QUADRO E HORIZONTAL. A lista da tela de
 * edicao desenha as colunas na mesma ordem do quadro; se um dia ela virar
 * vertical, o rotulo muda aqui e em nenhum outro lugar.
 */
export function moverColuna(
  colunas: readonly Coluna[],
  idMovida: string,
  direcao: Direcao,
): Coluna[] | null {
  const origem = colunas.findIndex((c) => c.id === idMovida);
  if (origem === -1) return null;
  return reordenarColunas(
    colunas,
    idMovida,
    direcao === "esquerda" ? origem - 1 : origem + 1,
  );
}

/**
 * A seta daquela direcao faz alguma coisa?
 *
 * ⚠️ E PARA DESABILITAR O BOTAO, e nao so para esconder. Botao que existe,
 * aceita clique e nao faz nada e pior que botao ausente: quem usa leitor de
 * tela ouve "botao mover para a esquerda", aperta, e nada e anunciado. `null`
 * de `moverColuna` protege o dado; isto protege a interacao.
 */
export function podeMover(
  colunas: readonly Coluna[],
  idMovida: string,
  direcao: Direcao,
): boolean {
  return moverColuna(colunas, idMovida, direcao) !== null;
}

/**
 * A ordem mudou de verdade entre duas listas?
 *
 * ⚠️ COMPARA SO OS IDS, NA ORDEM. A resposta do servidor traz as colunas
 * inteiras, com `position` ja densificada -- comparar objetos daria
 * "mudou" toda vez, porque `position` muda mesmo quando a ordem e a mesma.
 *
 * Serve para a tela decidir se precisa repintar depois da resposta: a
 * atualizacao otimista ja pos a ordem certa, e repintar com a mesma coisa
 * pisca a tela sem motivo.
 */
export function ordemIgual(
  a: readonly Coluna[],
  b: readonly Coluna[],
): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id);
}
