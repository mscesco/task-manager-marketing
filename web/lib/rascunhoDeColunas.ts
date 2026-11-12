/**
 * O rascunho da edição de colunas: tudo fica em memória e só ao concluir sai um
 * `PUT /boards/{id}/columns`. Puro (sem rede, DOM ou React) porque `onDragEnd`
 * não roda em jsdom: arraste e setas chamam as mesmas funções testáveis. Usa
 * referência (`string`) porque colunas novas ainda não têm id (`tmp:`).
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
  /** Token da paleta. `undefined` = não escolheu: vai ausente no lote e o backend usa a rotação. */
  readonly color?: string;
  /** `undefined` = `true`. */
  readonly notifyDeadline?: boolean;
}

/** A edição pendente inteira. Imutável: toda função devolve um novo. */
export interface Rascunho {
  /** Referências na ordem desejada. Inclui as `tmp:` e exclui as apagadas. */
  readonly ordem: readonly string[];
  /** ref -> nome novo. Só entra quem foi renomeado. */
  readonly nomes: Readonly<Record<string, string>>;
  /** Ids reais marcados para sumir. Coluna nova apagada some do rascunho. */
  readonly apagadas: readonly string[];
  readonly novas: readonly ColunaNova[];
  /**
   * ref -> cobra prazo? Só ids reais que a pessoa mexeu: mandar todas
   * desfaria mudanças concorrentes de outra pessoa.
   */
  readonly avisos: Readonly<Record<string, boolean>>;
  /**
   * Ids reais que passam a ser o alvo da semântica deles; `tmp:` nunca entra
   * (`comAlvo` recusa). Lista porque várias semânticas podem trocar no mesmo lote.
   */
  readonly alvos: readonly string[];
  /** Contador do apelido. Não reaproveita número: ver `comColunaNova`. */
  readonly proximoTmp: number;
}

/**
 * Prefixo do id de arraste do cabeçalho no `dnd-kit`. Sem ele o cabeçalho
 * (`useSortable`) e o corpo da coluna (`useDroppable`) teriam o mesmo id, e ao
 * sair do modo de edição o desmonte do cabeçalho levava junto o alvo do card.
 */
export const PREFIXO_ARRASTE_DE_CABECALHO = "cab:";

/** O id de arraste do cabeçalho de uma coluna. Ver o prefixo acima. */
export function idDeArrasteDoCabecalho(ref: string): string {
  return `${PREFIXO_ARRASTE_DE_CABECALHO}${ref}`;
}

/** A `ref` da coluna a partir do id de arraste, ou `null` se não for um (ids de card viajam no mesmo contexto). */
export function refDoArrasteDeCabecalho(id: string): string | null {
  return id.startsWith(PREFIXO_ARRASTE_DE_CABECALHO)
    ? id.slice(PREFIXO_ARRASTE_DE_CABECALHO.length)
    : null;
}

/**
 * A coluna sobre a qual o arraste terminou, a partir do `over` do `dnd-kit`.
 * Aceita os dois alvos de cada coluna (cabeçalho com prefixo e corpo sem), pois
 * o desempate entre eles depende da ordem de registro. `null` se não for coluna
 * deste rascunho.
 */
export function refDeColunaDoDrop(
  idDoDrop: string,
  rascunho: Rascunho,
): string | null {
  const semPrefixo = refDoArrasteDeCabecalho(idDoDrop);
  const candidato = semPrefixo ?? idDoDrop;
  return rascunho.ordem.includes(candidato) ? candidato : null;
}

export function ehNova(ref: string): boolean {
  return ref.startsWith(PREFIXO_TMP);
}

/**
 * A cor de uma coluna nova sem cor escolhida: neutra, porque quem decide é a
 * rotação do servidor. Com cor escolhida, desenha a escolhida.
 */
export const COR_DA_COLUNA_NOVA = "var(--border)";

/**
 * A `Coluna` de mentira que representa um `tmp:` para quem só lê `Coluna`.
 * `is_default_target: false` como o backend cria (é o que faz a conta do
 * impedimento bater); `position` não é lido.
 */
export function colunaDoRascunho(
  ref: string,
  nome: string,
  semantic: ColumnSemantic,
  /** `undefined` = automática -> cinza de "ainda não existe". */
  cor?: string,
): Coluna {
  return {
    id: ref,
    name: nome,
    color: cor ?? COR_DA_COLUNA_NOVA,
    position: 0,
    semantic,
    notify_deadline: true,
    // Coluna criada por gente nunca e ponte.
    is_status_bridge: false,
    is_default_target: false,
  } satisfies Coluna;
}

/**
 * As colunas que o kanban desenha no modo de edição, na ordem do rascunho,
 * incluindo as `tmp:` (vazias) e as marcadas para apagar (riscadas).
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
      saida.push(colunaDoRascunho(ref, nova.name, nova.semantic, nova.color));
      continue;
    }
    // Sem `!`: ao trocar de quadro o rascunho anterior sobrevive um render.
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
    avisos: {},
    alvos: [],
    proximoTmp: 1,
  };
}

/** Há algo para salvar? Decide se sair do modo precisa avisar. */
export function temPendencias(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
): boolean {
  if (
    rascunho.novas.length > 0 ||
    Object.keys(rascunho.avisos).length > 0 ||
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
    // Coluna nova guarda o nome nela mesma; `renomear` do backend só aceita UUID.
    return {
      ...rascunho,
      novas: rascunho.novas.map((n) =>
        n.ref === ref ? { ...n, name: nome } : n,
      ),
    };
  }
  return { ...rascunho, nomes: { ...rascunho.nomes, [ref]: nome } };
}

/** Marca ou desmarca uma coluna para sumir. Coluna nova é removida, não marcada. */
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
    // Marcar para apagar tira o alvo pedido; desmarcar não o devolve.
    alvos: marcada
      ? rascunho.alvos
      : rascunho.alvos.filter((r) => r !== ref),
  };
}

/**
 * Liga ou desliga a cobrança de prazo. Voltar ao valor original tira a entrada
 * do mapa (senão o rascunho fica "sujo"). Coluna nova mexe em `novas`.
 */
export function comAviso(
  rascunho: Rascunho,
  ref: string,
  valor: boolean,
  /** O valor que o servidor tem hoje. Usado para detectar a volta ao original. */
  original: boolean,
): Rascunho {
  if (ehNova(ref)) {
    return {
      ...rascunho,
      novas: rascunho.novas.map((n) =>
        n.ref === ref ? { ...n, notifyDeadline: valor } : n,
      ),
    };
  }
  const avisos = { ...rascunho.avisos };
  if (valor === original) delete avisos[ref];
  else avisos[ref] = valor;
  return { ...rascunho, avisos };
}

/**
 * Desfaz um "tornar padrão" ainda não salvo. O padrão que o servidor já tem não
 * se desmarca: cada semântica precisa de um.
 */
export function semAlvo(rascunho: Rascunho, ref: string): Rascunho {
  if (!rascunho.alvos.includes(ref)) return rascunho;
  return { ...rascunho, alvos: rascunho.alvos.filter((r) => r !== ref) };
}

/** Marca uma coluna como alvo da semântica dela (não existe desmarcar; `tmp:` é recusada). Desfaz a exclusão. */
export function comAlvo(rascunho: Rascunho, ref: string): Rascunho {
  if (ehNova(ref)) return rascunho;
  if (rascunho.alvos.includes(ref)) return rascunho;
  return {
    ...rascunho,
    alvos: [...rascunho.alvos, ref],
    apagadas: rascunho.apagadas.filter((r) => r !== ref),
  };
}

/**
 * Uma coluna nova, no fim da ordem (como o backend). `proximoTmp` nunca recua:
 * reaproveitar o apelido faria um `destino` apontar para outra coluna.
 */
export function comColunaNova(
  rascunho: Rascunho,
  nome: string,
  semantica: ColumnSemantic,
  /** Omitidos = a rotação escolhe a cor e a coluna cobra prazo. */
  cor?: string,
  avisaPrazo?: boolean,
): Rascunho {
  const ref = `${PREFIXO_TMP}${rascunho.proximoTmp}`;
  return {
    ...rascunho,
    novas: [
      ...rascunho.novas,
      { ref, name: nome, semantic: semantica, color: cor, notifyDeadline: avisaPrazo },
    ],
    ordem: [...rascunho.ordem, ref],
    proximoTmp: rascunho.proximoTmp + 1,
  };
}

/**
 * Reposiciona `ref` no índice pedido (grampeado na faixa). `null` quando nada
 * muda, para a seta na ponta não virar edição pendente.
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
  /** O `alvo` veio de um "tornar padrão" deste rascunho, ainda não salvo (pode desfazer). */
  readonly alvoPedido: boolean;
  /** `null` se pode ser apagada; o motivo, se não. */
  readonly impedimento: string | null;
  /** Cobra prazo? Valor efetivo: rascunho primeiro, servidor depois. */
  readonly avisaPrazo: boolean;
}

/**
 * O que a tela desenha, na ordem do rascunho. As apagadas continuam (riscadas).
 * O impedimento é calculado contra o estado final, como o backend fará no lote.
 */
export function linhasDeEdicao(
  rascunho: Rascunho,
  colunas: readonly Coluna[],
  /** O quadro editado e o padrao do time (repassado a `impedimentoDeExclusao`). */
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
      if (nova) return colunaDoRascunho(ref, nova.name, nova.semantic, nova.color);
      return porId.get(ref)!;
    })
    .filter(Boolean);

  // Semânticas cujo alvo o rascunho já trocou: o selo antigo some na hora.
  const semanticasReclamadas = new Set(
    rascunho.alvos
      .map((r) => porId.get(r)?.semantic)
      .filter((sem): sem is ColumnSemantic => sem !== undefined),
  );

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
      // O rascunho ganha do servidor.
      alvoPedido: rascunho.alvos.includes(ref),
      alvo:
        rascunho.alvos.includes(ref) ||
        ((real?.is_default_target ?? false) &&
          !(real && semanticasReclamadas.has(real.semantic))),
      // Clique de agora > escolha ao criar > servidor > default.
      avisaPrazo:
        rascunho.avisos[ref] ??
        nova?.notifyDeadline ??
        real?.notify_deadline ??
        true,
      impedimento:
        apagada || base === undefined
          ? null
          : (impedimentoDeExclusao(base, sobrantes, quadroPadrao)?.motivo ??
            null),
    };
  });
}

/**
 * O nome que ficaria repetido se este rascunho fosse aplicado, ou `null`.
 * Espelha `BoardService._assert_nomes_do_lote` para não perder o lote inteiro
 * num 422: confere o resultado final, ignora as marcadas, usa `trim()` (o
 * backend grava com `strip()`) e diferencia maiúsculas, como o backend.
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
 * As colunas que a revisão pode oferecer como destino, incluindo as `tmp:` e
 * com o nome do rascunho. Não filtra as marcadas: isso fica com a revisão.
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
    // Sem `!`: mesmo motivo de `colunasParaDesenhar`.
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
 * Quantas tarefas o lote diz que vai mover. Comparado com o `movidas` do
 * servidor para detectar que alguém mexeu no quadro no meio.
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
 * `destinos` é `id da apagada -> referência de destino` (UUID ou `tmp:`);
 * ausente = a coluna está vazia. `ordem` vai vazia quando não mudou ("não mexer").
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
      // Chave ausente (não `null`) quando ninguém escolheu: o backend cai na rotação.
      ...(n.color !== undefined ? { color: n.color } : {}),
      ...(n.notifyDeadline !== undefined
        ? { notify_deadline: n.notifyDeadline }
        : {}),
    })),
    // Só coluna que sobrevive.
    renomear: Object.entries(rascunho.nomes)
      .filter(([ref]) => !rascunho.apagadas.includes(ref) && !ehNova(ref))
      .map(([id, name]) => ({ id, name })),
    // Só ids reais.
    alvos: [...rascunho.alvos],
    // Só coluna que sobrevive e real (coluna nova leva o valor no `criar`).
    avisos: Object.entries(rascunho.avisos)
      .filter(([ref]) => !rascunho.apagadas.includes(ref) && !ehNova(ref))
      .map(([id, notify_deadline]) => ({ id, notify_deadline })),
    apagar: rascunho.apagadas.map((id) => ({
      id,
      destino: destinos[id] ?? null,
    })),
    ordem: mudouOrdem
      ? rascunho.ordem.filter((ref) => !rascunho.apagadas.includes(ref))
      : [],
  };
}
