/**
 * Spec 036, fatia 5b-6 -- o que o seletor de quadro mostra, e quem pode o que.
 *
 * FRONTEIRA (Spec 027): isto e DECISAO, entao mora em `lib/` -- funcao pura,
 * sem React, testavel. A tela desenha; nao decide. Mesmo remedio de
 * `lib/permissoesMembros.ts`, e pelo mesmo motivo: foi espalhar maquina de
 * estado dentro de componente grande que causou o bug do modal.
 *
 * ⚠️ ESTE ARQUIVO NAO E SEGURANCA. O backend trava de verdade
 * (`BoardService._assert_pode_gerir` e `_assert_quadro_editavel`). Aqui so
 * evitamos oferecer botao que o servidor vai recusar com 403 ou 422 -- se
 * divergir, o usuario ve erro em vez de brecha. Ao mudar a regra no backend,
 * mudar aqui junto.
 *
 * ⚠️ A LENTE NAO E UM QUADRO, E ESSA E A DISTINCAO QUE O ARQUIVO INTEIRO
 * EXISTE PARA MANTER. `/quadro/[teamId]` mostra o espelho do Quadro geral
 * filtrado por pessoa (ADR 0034) -- nao ha registro no banco, nao ha
 * `board_id`, e nao ha o que renomear. Ela aparece no MESMO seletor que os
 * quadros avulsos porque para quem usa sao dois lugares onde a tarefa pode
 * estar; mas so um dos dois tem afordancia de editar.
 */

import type { Quadro } from "./api";

/** O que o ator alcanca na gestao de quadros. */
export type AlcanceDeQuadro =
  /**
   * `board.manage.root` -- ADMIN/MANAGER. Alcanca qualquer time.
   *
   * ⚠️ NAO CONFUNDIR COM "pode tudo": as colunas do Quadro geral continuam
   * fora (fatia 5c), e a recusa e do backend.
   */
  | { readonly tipo: "amplo" }
  /**
   * `board.manage.subteam` -- SUPERVISOR. So nos subtimes onde ELE e
   * supervisor, e a lista importa: sem ela, o mapa de permissao sozinho
   * deixaria qualquer supervisor administrar o quadro de qualquer subtime.
   */
  | { readonly tipo: "subtime"; readonly subtimes: readonly string[] }
  /** Sem permissao: o seletor vira somente leitura. */
  | { readonly tipo: "nenhum" };

/** So o que precisamos do usuario autenticado -- facilita testar. */
export type AtorMinimo = {
  permissions: string[];
  teams: { team_id: string; role: string }[];
};

/**
 * Deriva o alcance a partir do `/auth/me`.
 *
 * ⚠️ `board.manage.root` GANHA de `board.manage.subteam`. Quem tem os dois --
 * e ADMIN e MANAGER tem, porque o mapa de permissoes e uniao de papeis e as
 * duas entram nos conjuntos deles -- fica com o alcance maior. Testar so o
 * supervisor deixaria esta linha invertida passar.
 */
export function alcanceDeQuadro(
  me: AtorMinimo | null | undefined,
): AlcanceDeQuadro {
  if (!me) return { tipo: "nenhum" };
  if (me.permissions.includes("board.manage.root")) return { tipo: "amplo" };
  if (me.permissions.includes("board.manage.subteam")) {
    return {
      tipo: "subtime",
      subtimes: me.teams
        .filter((t) => t.role === "SUPERVISOR")
        .map((t) => t.team_id),
    };
  }
  return { tipo: "nenhum" };
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

/**
 * Uma opcao do seletor.
 *
 * ⚠️ `id: null` E A LENTE, e nao "ainda nao carregou". A lente nao tem
 * registro no banco; usar um id falso ("lente", "") a faria parecer um quadro
 * para qualquer codigo que compare ids, e o primeiro `find` do proximo mes
 * devolveria um objeto que nao existe.
 */
/**
 * Quem edita as colunas do QUADRO GERAL (`board.manage.root`).
 *
 * ⚠️ EXISTE PARA A REGRA TER UM LUGAR SO. A tela `/quadro` precisava dela em
 * 17/08, quando o lapis do Quadro geral foi ligado, e a alternativa era
 * `alcance.tipo === "amplo"` escrito la dentro -- uma segunda definicao da
 * mesma coisa, que diverge da primeira sem nada ficar vermelho.
 *
 * ⚠️ NAO E `podeGerirQuadrosDe(alcance, idDaRaiz)`. Aquela responde "pode
 * gerir os quadros DO TIME X" e exige o id da raiz, que a tela `/quadro` nao
 * tem sem uma requisicao a mais. Esta responde a pergunta da raiz direto, e as
 * duas concordam por construcao: `board.manage.root` esta em ADMIN e MANAGER
 * (que e o `tipo: "amplo"` de `alcanceDeQuadro`) e nao no SUPERVISOR, e
 * MANAGER so existe na raiz (Spec 024).
 *
 * ⚠️ NAO E SEGURANCA. O backend recusa com 403; isto so evita oferecer um
 * botao que nao funcionaria.
 */
export function podeGerirQuadroDaRaiz(alcance: AlcanceDeQuadro): boolean {
  return alcance.tipo === "amplo";
}

export type OpcaoDeQuadro = {
  readonly id: string | null;
  readonly nome: string;
  /** Frase fixa, so na lente. */
  readonly descricao?: string;
  /**
   * ⚠️ AUSENTE, E NAO DESABILITADA (ADR 0034 item 2). Quando `false`, a tela
   * NAO desenha o botao de renomear -- nao desenha desabilitado. Afordancia
   * que nao funciona e afordancia em que alguem clica, e depois pergunta por
   * que nao aconteceu nada.
   */
  readonly podeRenomear: boolean;
};

/** A descricao fixa da lente (decisao de 11/08). */
export const DESCRICAO_DA_LENTE = "espelho do quadro geral";

/**
 * As opcoes do seletor, na ordem em que a tela desenha.
 *
 * A lente vem SEMPRE primeiro e SEMPRE existe -- ela e o que
 * `/quadro/[teamId]` mostrava antes desta fatia, e continua sendo o padrao de
 * quem abre a tela.
 *
 * ⚠️ FILTRA POR `team_id`, e o filtro nao e cosmetico. `GET /boards` devolve
 * todo quadro que a pessoa ALCANCA -- para um supervisor isso inclui o Quadro
 * geral da raiz e, para um ADMIN, os quadros de todos os subtimes. Sem o
 * filtro, o seletor do time A listaria o quadro do time B, e criar tarefa ali
 * a mandaria para um quadro que ninguem daquele time ve.
 *
 * ⚠️ O QUADRO PADRAO NUNCA ENTRA. Ele e o Quadro geral, que ja esta
 * representado pela LENTE -- lista-lo de novo poria a mesma coisa duas vezes
 * no mesmo menu, uma delas com afordancia de renomear que a outra nao tem.
 *
 * ⚠️ ORDEM POR NOME, e nao pela ordem que a API devolveu. `GET /boards` nao
 * promete ordem; sem isto o menu se reordenaria sozinho entre dois
 * carregamentos, e o item que a pessoa ia clicar mudaria de lugar.
 */
export function opcoesDoSeletor(
  quadros: readonly Quadro[],
  teamId: string,
  podeGerir: boolean,
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
      // ⚠️ SEMPRE `false`, inclusive para ADMIN. Nao ha o que renomear: a
      // lente nao existe como registro.
      podeRenomear: false,
    },
    ...avulsos.map((q) => ({
      id: q.id,
      nome: q.name,
      podeRenomear: podeGerir,
    })),
  ];
}

/**
 * A opcao que a tela desenha, dado o id selecionado.
 *
 * ⚠️ CAI NA LENTE QUANDO O ID NAO EXISTE MAIS, e em silencio de proposito. O
 * quadro pode ter sido apagado por outra pessoa, ou o id pode ter vindo de um
 * link velho. Mostrar um erro para quem so abriu a tela seria pior que mostrar
 * o lugar padrao dela.
 */
export function opcaoSelecionada(
  opcoes: readonly OpcaoDeQuadro[],
  idSelecionado: string | null,
): OpcaoDeQuadro {
  return opcoes.find((o) => o.id === idSelecionado) ?? opcoes[0];
}

/**
 * Valida o `?quadro=` da URL contra os quadros carregados.
 *
 * Devolve o id que a tela deve desenhar, ou `null` para a lente.
 *
 * ⚠️ POR QUE A URL, E NAO ESTADO DE COMPONENTE (13/08). Ate aqui a escolha do
 * quadro vivia num `useState` da pagina: F5 voltava para a lente, o link
 * mandado para um colega abria a lente, e o botao Voltar do navegador saia da
 * pagina do time em vez de desfazer a troca. E havia um efeito pior que os
 * tres: depois de criar uma tarefa no quadro avulso, um F5 devolvia a pessoa
 * para a lente -- onde a tarefa NAO aparece, porque a lente e espelho do
 * Quadro geral. O sintoma ficava identico ao do `board_id` que faltava no
 * corpo do `POST /tasks`, com causa completamente diferente.
 *
 * ⚠️ `quadros === null` DEVOLVE O PEDIDO SEM CONFERIR, e isso e o ponto. `null`
 * e "a lista ainda nao chegou", nao "nao ha quadros" -- conferir agora
 * derrubaria toda selecao para a lente por um instante a cada carga, e a tela
 * piscaria a lente antes de mostrar o quadro pedido.
 *
 * ⚠️ CONFERE O **TIME** TAMBEM, e nao so a existencia. `listBoards` devolve
 * tudo que a pessoa alcanca, inclusive quadros de outros times. Sem esta
 * parte, `/quadro/{timeA}?quadro={quadroDoTimeB}` desenharia o quadro de B sob
 * a pagina de A -- e o seletor, que filtra por time, nao teria aba marcada:
 * corpo mostrando um quadro, cabecalho dizendo "Lente do time".
 *
 * ⚠️ ID INVALIDO CAI NA LENTE EM SILENCIO, igual ao `opcaoSelecionada` acima e
 * pelo mesmo motivo: link velho, quadro apagado por outra pessoa, ou id
 * digitado na mao. Erro na cara de quem so abriu a tela seria pior que o lugar
 * padrao dela.
 */
export function quadroPedidoNaUrl(
  parametro: string | null | undefined,
  quadros: readonly Quadro[] | null,
  teamId: string,
): string | null {
  if (!parametro) return null;
  if (quadros === null) return parametro;
  const achado = quadros.find((q) => q.id === parametro);
  if (!achado || achado.team_id !== teamId || achado.is_default) return null;
  return parametro;
}

/**
 * O endereco de uma escolha do seletor. `null` = lente.
 *
 * ⚠️ MORA AQUI, e nao na pagina, para o teste alcancar. O `include` do
 * `vitest.config.ts` e so `lib/**` e `components/**`: qualquer regra escrita
 * dentro de `app/` nasce sem guardiao nenhum.
 */
export function urlDoQuadro(teamId: string, boardId: string | null): string {
  const base = `/quadro/${teamId}`;
  return boardId ? `${base}?quadro=${encodeURIComponent(boardId)}` : base;
}

/**
 * Valida o nome de um quadro ANTES de mandar para a API.
 *
 * Devolve o nome limpo, ou `null` quando nao serve.
 *
 * ⚠️ ESPELHA `BoardService._nome_valido` (255, nao-vazio depois do `trim`), e
 * a duplicacao e o preco de nao mandar uma requisicao que ja se sabe que volta
 * 422. ⚠️ COLUNA TEM OUTRO TETO (120) -- sao duas regras, e reaproveitar esta
 * para coluna deixaria passar um nome que o Postgres recusa com
 * `StringDataRightTruncation`, que sai como 500.
 */
export function nomeDeQuadroValido(nome: string): string | null {
  const limpo = nome.trim();
  if (!limpo) return null;
  if (limpo.length > 255) return null;
  return limpo;
}
