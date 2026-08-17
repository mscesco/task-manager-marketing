/**
 * O RASCUNHO da edição de colunas (Spec 036, fatia 6c-1).
 *
 * ⚠️ NO MODO DE EDIÇÃO NADA VAI AO SERVIDOR. A pessoa renomeia, arrasta, marca
 * colunas para sumir e cria colunas -- tudo aqui dentro, em memória --, e só ao
 * concluir sai **um** pedido (`PUT /boards/{id}/columns`). Este arquivo é esse
 * "aqui dentro", e ele é puro: nenhuma linha toca em rede, DOM ou React.
 *
 * ⚠️ POR QUE PURO, E NÃO ESTADO DENTRO DO COMPONENTE. O arraste de cabeçalho é
 * `onDragEnd`, que **não roda em jsdom** -- o produto já tem dois assim, e este
 * é o terceiro. Se a regra de "o que a edição virou" morasse no handler, ela
 * nasceria sem guardião. Aqui, o arraste e as setas chamam a MESMA função, e o
 * caminho testável exercita a linha que o não testável usa.
 *
 * ⚠️ O QUE O LOTE PERMITE, E É A RAZÃO DE ELE EXISTIR: trocar uma coluna por
 * outra num gesto. Criar "Entregue", mandar as tarefas de "Aprovação" para ela
 * e apagar "Aprovação" -- tudo antes de existir id nenhum. É daí que vem o
 * `tmp:`, e é por isso que este módulo trabalha com REFERÊNCIA (`string`) e não
 * com `Coluna`.
 */

import type { Coluna, ColumnSemantic } from "@/lib/coluna";
import type { LoteDeColunas } from "@/lib/api";
import { impedimentoDeExclusao } from "@/lib/edicaoDeColunas";

/** Prefixo que distingue apelido de cliente de UUID. Igual ao do backend. */
export const PREFIXO_TMP = "tmp:";

/** Uma coluna que só existe no rascunho. */
export interface ColunaNova {
  readonly ref: string;
  readonly name: string;
  readonly semantic: ColumnSemantic;
}

/**
 * A edição pendente inteira.
 *
 * ⚠️ IMUTÁVEL, e toda função devolve um novo. É o que faz o React repintar sem
 * comparação profunda, e o que permite "descartar" jogando o objeto fora.
 */
export interface Rascunho {
  /** Referências na ordem desejada. Inclui as `tmp:` e exclui as apagadas. */
  readonly ordem: readonly string[];
  /** ref -> nome novo. Só entra quem foi renomeado. */
  readonly nomes: Readonly<Record<string, string>>;
  /** Ids reais marcados para sumir. ⚠️ Coluna nova apagada some do rascunho. */
  readonly apagadas: readonly string[];
  readonly novas: readonly ColunaNova[];
  /** Contador do apelido. ⚠️ Não reaproveita número: ver `comColunaNova`. */
  readonly proximoTmp: number;
}

export function ehNova(ref: string): boolean {
  return ref.startsWith(PREFIXO_TMP);
}

/**
 * A cor de uma coluna que ainda não existe.
 *
 * ⚠️ NEUTRA DE PROPÓSITO, E NÃO UM PALPITE. Quem escolhe a cor é o servidor
 * (`_cor_por_rotacao(len(existentes))`, em `board_service.py`), e num lote com
 * duas criações o índice de cada uma depende da ordem em que o backend as grava
 * -- o front não tem como acertar. Mostrar uma cor que vai mudar sozinha depois
 * de concluir seria a tela prometendo o que não entrega.
 *
 * ⚠️ E ELA COMUNICA. Cinza de borda no meio de colunas coloridas é o sinal de
 * "esta ainda não existe" sem precisar de legenda.
 */
export const COR_DA_COLUNA_NOVA = "var(--border)";

/**
 * A `Coluna` de mentira que representa um `tmp:` para quem só sabe ler `Coluna`.
 *
 * ⚠️ FONTE ÚNICA, E ESSE É O PONTO. Esta forma já existia escrita à mão em
 * TRÊS lugares -- `linhasDeEdicao` (sobrantes), o `Board.tsx` e a
 * `RevisaoDaEdicao` --, e as três precisavam concordar em `is_default_target:
 * false`, que é o que faz a conta do impedimento bater com a do servidor. Três
 * cópias de uma regra é exatamente como a ADR 0042 divergiu.
 *
 * ⚠️ `is_default_target: false` PORQUE É ASSIM QUE O BACKEND CRIA
 * (`criar_coluna` crava `False`). Criar uma segunda coluna de conclusão **não**
 * libera apagar a atual, e é aqui que isso fica verdadeiro.
 *
 * ⚠️ `position: 0` É LIXO E NÃO É LIDO. A posição de verdade é o índice em
 * `rascunho.ordem`; o campo existe só porque o tipo `Coluna` o exige.
 */
export function colunaDoRascunho(
  ref: string,
  nome: string,
  semantic: ColumnSemantic,
): Coluna {
  return {
    id: ref,
    name: nome,
    color: COR_DA_COLUNA_NOVA,
    position: 0,
    semantic,
    notify_deadline: true,
    // ⚠️ COLUNA CRIADA POR GENTE NUNCA E PONTE (`criar_coluna` crava
    // `legacy_status=None`). Logo, ela e apagavel ate no Quadro geral -- e e
    // isso que torna a trava da ponte estreita em vez de simbolica.
    is_status_bridge: false,
    is_default_target: false,
  } satisfies Coluna;
}

/**
 * As colunas que o kanban desenha com o modo de edição ligado, na ordem do
 * rascunho e **incluindo as `tmp:`**.
 *
 * ⚠️ ATÉ 17/08 A COLUNA NOVA FICAVA NA `ordem` E FORA DA TELA, e isso era um
 * meio-termo que não se sustentava. O ref entrava em `rascunho.ordem` (então
 * `comOrdem` a movia) e era filtrado do que o `Board.tsx` desenhava -- logo:
 * as setas ← → moviam uma coluna invisível, o `SortableContext` não a conhecia,
 * e `indice`/`total` de TODOS os cabeçalhos ficavam errados a partir dela,
 * porque um contava com a nova e o outro sem. **Não dava para posicionar a
 * coluna criada antes de concluir** -- que é metade do gesto que o lote existe
 * para permitir.
 *
 * ⚠️ ELA NASCE VAZIA E CONTINUA VAZIA. Não tem id real, então nenhuma tarefa
 * aponta para ela e nenhum card cai ali. Isso é honesto: no modo de edição os
 * cards estão travados de qualquer forma, e a coluna só passa a receber tarefa
 * depois de existir no servidor.
 *
 * ⚠️ AS MARCADAS PARA APAGAR CONTINUAM AQUI, riscadas pelo cabeçalho. Mesma
 * razão de `linhasDeEdicao`: sumir no clique quebraria o desfazer.
 */
export function colunasParaDesenhar(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): Coluna[] {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const novasPorRef = new Map(rascunho.novas.map((n) => [n.ref, n]));
  const saida: Coluna[] = [];
  for (const ref of rascunho.ordem) {
    const nova = novasPorRef.get(ref);
    if (nova) {
      saida.push(colunaDoRascunho(ref, nova.name, nova.semantic));
      continue;
    }
    // ⚠️ SEM `!`. Um ref sem coluna real acontece de verdade: trocar de quadro
    // com o modo ligado deixa o rascunho do quadro anterior em pé por um
    // render. Aquele `!` foi o `TypeError` de 17/08; aqui a linha some da tela
    // em vez de derrubar a página.
    const real = porId.get(ref);
    if (real) saida.push(real);
  }
  return saida;
}

/** O rascunho de quem abriu o modo e não mexeu em nada. */
export function rascunhoInicial(colunas: readonly Coluna[]): Rascunho {
  return {
    ordem: colunas.map((c) => c.id),
    nomes: {},
    apagadas: [],
    novas: [],
    proximoTmp: 1,
  };
}

/**
 * Há algo para salvar?
 *
 * ⚠️ É O QUE DECIDE SE SAIR DO MODO PRECISA AVISAR. Sem isto, fechar a edição
 * descartaria em silêncio uma coluna que a pessoa acabou de criar -- e ela
 * some sem explicação, porque nunca chegou a existir no servidor.
 */
export function temPendencias(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): boolean {
  if (
    rascunho.novas.length > 0 ||
    rascunho.apagadas.length > 0 ||
    Object.keys(rascunho.nomes).length > 0
  ) {
    return true;
  }
  const original = colunas.map((c) => c.id);
  return (
    rascunho.ordem.length !== original.length ||
    rascunho.ordem.some((ref, i) => ref !== original[i])
  );
}

/** Renomear. `nome` vazio é ignorado -- quem valida tamanho é a tela. */
export function comRenome(
  rascunho: Rascunho,
  ref: string,
  nome: string,
): Rascunho {
  if (ehNova(ref)) {
    // ⚠️ COLUNA NOVA GUARDA O NOME NELA MESMA, e não em `nomes`. Se fosse nos
    // dois, o lote diria duas coisas sobre a mesma linha -- `criar` com um nome
    // e `renomear` com outro -- e a ordem entre as etapas viraria regra
    // invisível. O backend nem aceitaria: `renomear` só recebe UUID.
    return {
      ...rascunho,
      novas: rascunho.novas.map((n) =>
        n.ref === ref ? { ...n, name: nome } : n,
      ),
    };
  }
  return { ...rascunho, nomes: { ...rascunho.nomes, [ref]: nome } };
}

/**
 * Marca ou desmarca uma coluna para sumir.
 *
 * ⚠️ COLUNA NOVA NÃO É "MARCADA", É REMOVIDA. Ela nunca existiu no servidor;
 * marcá-la produziria um lote que pede para apagar um id que ele mesmo acabou
 * de criar. O backend recusaria -- e com razão.
 */
export function comMarcacao(rascunho: Rascunho, ref: string): Rascunho {
  if (ehNova(ref)) {
    return {
      ...rascunho,
      novas: rascunho.novas.filter((n) => n.ref !== ref),
      ordem: rascunho.ordem.filter((r) => r !== ref),
    };
  }
  const marcada = rascunho.apagadas.includes(ref);
  return {
    ...rascunho,
    apagadas: marcada
      ? rascunho.apagadas.filter((r) => r !== ref)
      : [...rascunho.apagadas, ref],
  };
}

/**
 * Uma coluna nova, no fim da ordem.
 *
 * ⚠️ NO FIM, IGUAL AO BACKEND (`position=len(existentes)`). A pessoa arrasta
 * depois. Nascer no meio exigiria uma segunda mecânica de posição, e um segundo
 * lugar para errar.
 *
 * ⚠️ `proximoTmp` NUNCA RECUA, mesmo quando uma coluna nova é removida. Se
 * recuasse, criar-apagar-criar reaproveitaria o apelido -- e um `destino`
 * apontando para `tmp:1` passaria a significar outra coluna, sem nada na tela
 * mudar. O backend recusa apelido repetido, mas isso aqui nem chega lá.
 */
export function comColunaNova(
  rascunho: Rascunho,
  nome: string,
  semantica: ColumnSemantic,
): Rascunho {
  const ref = `${PREFIXO_TMP}${rascunho.proximoTmp}`;
  return {
    ...rascunho,
    novas: [...rascunho.novas, { ref, name: nome, semantic: semantica }],
    ordem: [...rascunho.ordem, ref],
    proximoTmp: rascunho.proximoTmp + 1,
  };
}

/**
 * Reposiciona `ref` no índice pedido. `null` = nada muda.
 *
 * ⚠️ MESMO CONTRATO DE `lib/ordemDeColunas`: `null` quando nada muda, e destino
 * grampeado na faixa. É o que impede a seta na ponta de virar edição pendente
 * -- e, com ela, um aviso de "há alterações não salvas" sobre nada.
 */
export function comOrdem(
  rascunho: Rascunho,
  ref: string,
  indiceDestino: number,
): Rascunho | null {
  const origem = rascunho.ordem.indexOf(ref);
  if (origem === -1) return null;
  const destino = Math.min(
    Math.max(indiceDestino, 0),
    rascunho.ordem.length - 1,
  );
  if (destino === origem) return null;
  const nova = [...rascunho.ordem];
  const [movida] = nova.splice(origem, 1);
  nova.splice(destino, 0, movida);
  return { ...rascunho, ordem: nova };
}

/** Uma linha da tela de edição. */
export interface LinhaDeEdicao {
  readonly ref: string;
  readonly nome: string;
  readonly semantic: ColumnSemantic;
  /** Marcada para sumir -- a tela risca. */
  readonly apagada: boolean;
  /** Só existe no rascunho. */
  readonly nova: boolean;
  /** Recebe as tarefas quando o sistema decide sozinho. */
  readonly alvo: boolean;
  /** `null` se pode ser apagada; o motivo, se não. */
  readonly impedimento: string | null;
}

/**
 * O que a tela desenha, na ordem do rascunho.
 *
 * ⚠️ AS APAGADAS CONTINUAM NA LISTA, riscadas. Tirá-las faria a coluna sumir no
 * clique -- e o modelo é de lote: enquanto não concluir, nada aconteceu, e a
 * pessoa precisa poder desmarcar.
 *
 * ⚠️ O IMPEDIMENTO É CALCULADO CONTRA O ESTADO FINAL, e não contra o quadro de
 * agora. É a mesma conta que o backend fará no lote. Repare que criar uma
 * segunda coluna de conclusão **não** libera apagar a atual: coluna nova nasce
 * com `is_default_target: false`, e o que tem de sobrar é um ALVO. É aqui que a
 * ausência de "trocar o alvo de uma semântica" aparece para quem usa.
 */
export function linhasDeEdicao(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
  /**
   * O quadro editado e o PADRAO do time. ⚠️ Repassado a
   * `impedimentoDeExclusao`, que precisa das DUAS metades da trava da ponte --
   * ver o parametro homonimo la. `false` por padrao pelo mesmo motivo: o
   * caminho perigoso e o que exige ser escrito.
   */
  quadroPadrao = false,
): LinhaDeEdicao[] {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const novasPorRef = new Map(rascunho.novas.map((n) => [n.ref, n]));

  // As colunas que SOBRAM depois do lote, no formato que `impedimentoDeExclusao`
  // entende. As novas entram com `is_default_target: false`, como o backend as
  // cria -- é o que faz a conta bater com a que o servidor fará.
  const sobrantes: Coluna[] = rascunho.ordem
    .filter((ref) => !rascunho.apagadas.includes(ref))
    .map((ref) => {
      const nova = novasPorRef.get(ref);
      if (nova) return colunaDoRascunho(ref, nova.name, nova.semantic);
      return porId.get(ref)!;
    })
    .filter(Boolean);

  return rascunho.ordem.map((ref) => {
    const nova = novasPorRef.get(ref);
    const real = porId.get(ref);
    const base: Coluna | undefined = nova
      ? sobrantes.find((c) => c.id === ref)
      : real;
    const apagada = rascunho.apagadas.includes(ref);
    const nome = nova ? nova.name : (rascunho.nomes[ref] ?? real?.name ?? "");
    return {
      ref,
      nome,
      semantic: (base?.semantic ?? "IN_PROGRESS") as ColumnSemantic,
      apagada,
      nova: nova !== undefined,
      alvo: real?.is_default_target ?? false,
      // ⚠️ SÓ PARA QUEM AINDA NÃO ESTÁ MARCADA: o impedimento de quem já está
      // riscada não interessa, e calculá-lo contra uma lista que já a exclui
      // daria sempre `null`.
      impedimento:
        apagada || base === undefined
          ? null
          : (impedimentoDeExclusao(base, sobrantes, quadroPadrao)?.motivo ??
            null),
    };
  });
}

/**
 * O nome que ficaria repetido se este rascunho fosse aplicado -- ou `null`.
 *
 * ⚠️ ESPELHA `BoardService._assert_nomes_do_lote`, e a duplicacao e a mesma de
 * `nomeDeQuadroValido`: existe para nao gastar um pedido que ja se sabe que
 * volta 422. **Aqui ela vale muito mais que la.** No lote, a recusa perde a
 * edicao INTEIRA -- a pessoa renomeia quatro colunas, cria uma, arrasta duas, e
 * descobre no "Concluir edicao" que dois nomes bateram. O backend continua
 * sendo a autoridade; isto e o que impede a pessoa de chegar ate ele.
 *
 * ⚠️ CONFERE O RESULTADO FINAL, e nao cada mexida. Trocar dois nomes entre si
 * e apagar-e-recriar com o mesmo nome sao gestos LEGITIMOS que passam pelo
 * estado repetido no meio do caminho -- ver o docstring do metodo do backend.
 * Barrar durante a digitacao acusaria a pessoa no meio de uma troca valida.
 *
 * ⚠️ IGNORA AS MARCADAS PARA APAGAR: uma coluna que vai sumir nao ocupa nome.
 * E usa o nome do RASCUNHO, nao o do servidor.
 *
 * ⚠️ `trim()` PORQUE O BACKEND GRAVA COM `strip()`. Sem isto `"Feito "` passa
 * daqui como nome diferente e chega la como o mesmo -- 422 exatamente no caso
 * que esta funcao existe para evitar.
 *
 * ⚠️ MAIUSCULA CONTA, igual ao backend (decisao de 18/08): "Feito" e "feito"
 * convivem. Comparar em minusculas deixaria a tela mais restritiva que o
 * servidor -- ela recusaria um nome que o backend aceita, e ninguem
 * descobriria, porque o caminho feliz nunca e exercitado contra o servidor.
 */
export function nomeRepetidoNoRascunho(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): string | null {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const novasPorRef = new Map(rascunho.novas.map((n) => [n.ref, n]));

  const vistos = new Set<string>();
  for (const ref of rascunho.ordem) {
    if (rascunho.apagadas.includes(ref)) continue;
    const nova = novasPorRef.get(ref);
    const bruto = nova
      ? nova.name
      : (rascunho.nomes[ref] ?? porId.get(ref)?.name);
    if (bruto === undefined) continue;
    const nome = bruto.trim();
    if (vistos.has(nome)) return nome;
    vistos.add(nome);
  }
  return null;
}

/** Uma coluna que pode receber as tarefas: existente ou criada no rascunho. */
export interface DestinoPossivel {
  readonly ref: string;
  readonly nome: string;
  readonly semantic: ColumnSemantic;
}

/**
 * As colunas que a revisão pode oferecer como destino.
 *
 * ⚠️ SUBSTITUI O `destinosPara` DE `edicaoDeColunas` (13/08), e a diferença é a
 * única que importa: **inclui as colunas `tmp:`**. Sem elas, apagar "Aprovação"
 * mandando as tarefas para a "Entregue" que a pessoa acabou de criar não
 * funciona -- e esse gesto é a razão de ser do lote inteiro.
 *
 * ⚠️ NASCEU COMO DUPLICATA DENTRO DO `Board.tsx`, e virou isto. O `plan.md` já
 * dizia que `destinosPara` precisaria aceitar `tmp:`; em vez disso apareceu uma
 * segunda versão da mesma ideia num arquivo de 2000 linhas, sem guardião. É a
 * mesma forma pela qual a regra da ADR 0042 divergiu em três lugares.
 *
 * ⚠️ NÃO FILTRA AS MARCADAS. Quem faz isso é a revisão, que precisa saber quais
 * são para não oferecer uma como destino da outra -- e o motivo é que a ordem
 * das exclusões no lote decidiria o resultado, e ela vem da ordem dos cliques.
 *
 * ⚠️ USA O NOME DO RASCUNHO, e não o do servidor. Renomear "Concluído" para
 * "Entregue" e no mesmo lote apagar outra coluna mandando tarefas para lá tem
 * de mostrar o nome novo -- senão a revisão descreve um quadro que já não é o
 * que a pessoa está vendo.
 */
export function destinosDoRascunho(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): DestinoPossivel[] {
  const saida: DestinoPossivel[] = [];
  for (const ref of rascunho.ordem) {
    const nova = rascunho.novas.find((n) => n.ref === ref);
    if (nova) {
      saida.push({ ref, nome: nova.name, semantic: nova.semantic });
      continue;
    }
    // ⚠️ AQUI MORAVA UM `!`, E ELE ESTOUROU EM PRODUÇÃO DE MENTIRA (17/08):
    // `TypeError: Cannot read properties of undefined (reading 'name')`,
    // linha 312. O caminho é trocar de quadro com o modo de edição ligado --
    // o rascunho do quadro anterior sobrevive um render contra as colunas do
    // novo, e nenhum ref casa. **O `!` não é uma afirmação sobre o mundo, é um
    // pedido para o `tsc` calar.** Mesma correção de `colunasParaDesenhar`.
    const real = colunas.find((c) => c.id === ref);
    if (!real) continue;
    saida.push({
      ref,
      nome: rascunho.nomes[ref] ?? real.name,
      semantic: real.semantic,
    });
  }
  return saida;
}

/**
 * Quantas tarefas o lote diz que vai mover, somando as marcadas.
 *
 * ⚠️ EXISTE PARA COMPARAR COM O `movidas` QUE O SERVIDOR DEVOLVE. Se os dois
 * discordarem, alguém mexeu no quadro entre a revisão e a confirmação -- e o
 * `mensagemDeDivergencia` de `edicaoDeColunas` é quem diz isso. **Este aviso
 * existia no painel antigo e se perdeu no redesenho; isto o traz de volta.**
 */
export function totalPrevisto(
  rascunho: Rascunho,
  contagens: Readonly<Record<string, number>>,
): number {
  return rascunho.apagadas.reduce((soma, id) => soma + (contagens[id] ?? 0), 0);
}

/** As colunas marcadas que a revisão precisa perguntar o destino. */
export function marcadasParaApagar(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): Coluna[] {
  return colunas.filter((c) => rascunho.apagadas.includes(c.id));
}

/**
 * O corpo do `PUT /boards/{id}/columns`.
 *
 * `destinos` é `id da apagada -> referência de destino` (UUID ou `tmp:`),
 * respondido na revisão. Ausente = a coluna está vazia.
 *
 * ⚠️ `ordem` VAI VAZIA QUANDO A ORDEM NÃO MUDOU. O backend lê vazio como "não
 * mexer"; mandar a lista igual funcionaria, mas transformaria toda edição num
 * pedido de reordenação, e o log do servidor deixaria de distinguir quem
 * arrastou de quem só renomeou.
 */
export function paraLote(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
  destinos: Readonly<Record<string, string | null>> = {},
): LoteDeColunas {
  const mudouOrdem = (() => {
    const finais = rascunho.ordem.filter(
      (ref) => !rascunho.apagadas.includes(ref),
    );
    const original = colunas
      .map((c) => c.id)
      .filter((id) => !rascunho.apagadas.includes(id));
    return (
      finais.length !== original.length ||
      finais.some((ref, i) => ref !== original[i])
    );
  })();

  return {
    criar: rascunho.novas.map((n) => ({
      tmp: n.ref.slice(PREFIXO_TMP.length),
      name: n.name,
      semantic: n.semantic,
    })),
    // ⚠️ SÓ COLUNA QUE SOBREVIVE. Renomear e apagar a mesma coluna no mesmo
    // lote faria o backend renomear uma linha que a etapa seguinte remove --
    // trabalho e uma entrada de log que não aconteceu do ponto de vista de quem
    // usa.
    renomear: Object.entries(rascunho.nomes)
      .filter(([ref]) => !rascunho.apagadas.includes(ref) && !ehNova(ref))
      .map(([id, name]) => ({ id, name })),
    apagar: rascunho.apagadas.map((id) => ({
      id,
      destino: destinos[id] ?? null,
    })),
    ordem: mudouOrdem
      ? rascunho.ordem.filter((ref) => !rascunho.apagadas.includes(ref))
      : [],
  };
}
