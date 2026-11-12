/**
 * O que o seletor de quadro mostra e quem pode o quê. Não é segurança: o
 * backend recusa de verdade; aqui só se evita oferecer o botão que daria 403.
 *
 * A lente (`/quadro/[teamId]`) não é um quadro: é o espelho do Quadro geral
 * filtrado, sem registro no banco nem `board_id`.
 */

import type { Quadro } from "./api";
import { alcancePor, type Alcance, type AtorMinimo } from "./alcance";
import type { Permission } from "./permissions.generated";

export type { AtorMinimo } from "./alcance";

/** O que o ator alcança na gestão de quadros. "amplo" não inclui as colunas
 *  do Quadro geral. */
export type AlcanceDeQuadro = Alcance;

export function alcanceDeQuadro(me: AtorMinimo | null | undefined): AlcanceDeQuadro {
  return alcancePor(me, "board.update.root", "board.update");
}

/** True se o ator pode criar e renomear quadro NESTE time. */
export function podeGerirQuadrosDe(
  alcance: AlcanceDeQuadro,
  teamId: string,
): boolean {
  if (alcance.tipo === "amplo") return true;
  if (alcance.tipo === "subtime") return alcance.subtimes.includes(teamId);
  return false;
}

export { nomeConfere } from "./confirmarNome";

/** Quem edita o Quadro geral; não pede o id da raiz, que a tela `/quadro` não tem. */
export function podeGerirQuadroDaRaiz(alcance: AlcanceDeQuadro): boolean {
  return alcance.tipo === "amplo";
}

/** Uma opção do seletor. `id: null` é a lente, não "ainda não carregou". */
export type OpcaoDeQuadro = {
  readonly id: string | null;
  readonly nome: string;
  /** Frase fixa, só na lente. */
  readonly descricao?: string;
  /** `false` = a tela não desenha o botão (ausente, não desabilitado). */
  readonly podeRenomear: boolean;
  /** `false` = ausente. Apagar quadro apaga as tarefas dentro. */
  readonly podeApagar: boolean;
};

export const DESCRICAO_DA_LENTE = "espelho do quadro geral";

/**
 * As opções do seletor de um subtime: a lente primeiro, depois os quadros
 * avulsos do time por nome. Filtra por `team_id` porque `GET /boards` devolve
 * tudo que a pessoa alcança; o quadro padrão fica de fora porque a lente já o
 * representa.
 */
export function opcoesDoSeletor(
  quadros: readonly Quadro[],
  teamId: string,
  podeGerir: boolean,
  /** Separado de `podeGerir`: o gestor renomeia e não apaga. */
  podeApagar: boolean,
): OpcaoDeQuadro[] {
  const avulsos = quadros
    .filter((q) => q.team_id === teamId && !q.is_default)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return [
    {
      id: null,
      nome: "Lente do time",
      descricao: DESCRICAO_DA_LENTE,
      // A lente não existe como registro: nada a renomear nem apagar.
      podeRenomear: false,
      podeApagar: false,
    },
    ...avulsos.map((q) => ({
      id: q.id,
      nome: q.name,
      podeRenomear: podeGerir,
      podeApagar,
    })),
  ];
}

/**
 * Pode apagar quadro avulso neste nível (`board.delete.root` na raiz,
 * `board.delete` no subtime). A tela combina com `podeGerirQuadrosDe`, que
 * responde "onde".
 */
export function podeApagarQuadros(
  permissoes: readonly Permission[],
  ehRaiz: boolean,
): boolean {
  return permissoes.includes(ehRaiz ? "board.delete.root" : "board.delete");
}

/** Pode apagar coluna. A tela combina com `podeGerirQuadrosDe`. */
export function podeApagarColunas(permissoes: readonly Permission[]): boolean {
  return permissoes.includes("column.delete");
}

/**
 * As opções do seletor da raiz. Na raiz não há lente: o primeiro item é o
 * próprio Quadro geral, com `id` de verdade, renomeável e nunca apagável.
 */
export function opcoesDoSeletorDaRaiz(
  quadros: readonly Quadro[],
  rootTeamId: string,
  podeGerir: boolean,
  podeApagar: boolean,
): OpcaoDeQuadro[] {
  const daRaiz = quadros.filter((q) => q.team_id === rootTeamId);
  const geral = daRaiz.find((q) => q.is_default);
  const avulsos = daRaiz
    .filter((q) => !q.is_default)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return [
    ...(geral
      ? [
          {
            id: geral.id,
            nome: geral.name,
            podeRenomear: podeGerir,
            podeApagar: false,
          },
        ]
      : []),
    ...avulsos.map((q) => ({
      id: q.id,
      nome: q.name,
      podeRenomear: podeGerir,
      podeApagar,
    })),
  ];
}

/** A opção desenhada; cai na lente, em silêncio, se o id não existe mais. */
export function opcaoSelecionada(
  opcoes: readonly OpcaoDeQuadro[],
  idSelecionado: string | null,
): OpcaoDeQuadro {
  return opcoes.find((o) => o.id === idSelecionado) ?? opcoes[0];
}

/** Por que o `?quadro=` da URL não virou o quadro desenhado. */
export type MotivoDaQueda =
  /** Apagado, inexistente ou fora do alcance: daqui não dá para distinguir. */
  | "fora-de-alcance"
  /** O quadro é de outro time (link colado da página errada). */
  | "outro-time"
  /** É o quadro padrão, que nesta tela a lente representa. */
  | "e-o-quadro-geral";

export type QuadroPedido = {
  /** O id a desenhar, ou `null` para a lente. */
  readonly id: string | null;
  /** `null` = nada a dizer. */
  readonly motivo: MotivoDaQueda | null;
};

/**
 * Valida o `?quadro=` da URL contra os quadros carregados e diz por que caiu.
 * Confere também o time, porque `listBoards` traz quadros de outros times.
 * `quadros === null` (ainda carregando) não produz motivo: senão o aviso
 * piscaria em todo carregamento.
 */
export function resolverQuadroPedido(
  parametro: string | null | undefined,
  quadros: readonly Quadro[] | null,
  teamId: string,
): QuadroPedido {
  if (!parametro) return { id: null, motivo: null };
  if (quadros === null) return { id: parametro, motivo: null };

  const achado = quadros.find((q) => q.id === parametro);
  if (!achado) return { id: null, motivo: "fora-de-alcance" };
  if (achado.is_default) return { id: null, motivo: "e-o-quadro-geral" };
  if (achado.team_id !== teamId) return { id: null, motivo: "outro-time" };
  return { id: parametro, motivo: null };
}

export const TEXTO_DA_QUEDA: Record<MotivoDaQueda, string> = {
  "fora-de-alcance":
    "O quadro que você pediu não está mais aqui — ele pode ter sido apagado, " +
    "ou o link pode estar velho. Mostrando a lente do time.",
  "outro-time":
    "Esse quadro é de outro time. Mostrando a lente deste time.",
  "e-o-quadro-geral":
    "Esse é o Quadro geral, e a lente do time já é o espelho dele.",
};

/** O endereço de uma escolha do seletor. `null` = lente. */
export function urlDoQuadro(teamId: string, boardId: string | null): string {
  const base = `/quadro/${teamId}`;
  return boardId ? `${base}?quadro=${encodeURIComponent(boardId)}` : base;
}

/**
 * Valida o nome de um quadro antes da API; devolve o nome limpo ou `null`.
 * Espelha `BoardService._nome_valido` (255). Coluna tem outro teto (120).
 */
export function nomeDeQuadroValido(nome: string): string | null {
  const limpo = nome.trim();
  if (!limpo) return null;
  if (limpo.length > 255) return null;
  return limpo;
}
