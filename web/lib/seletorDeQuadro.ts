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
import type { Permission } from "./permissions.generated";

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
  permissions: Permission[];
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
  // Spec 049, fatia A: eram `board.manage.root` e `board.manage.subteam`.
  if (me.permissions.includes("board.update.root")) return { tipo: "amplo" };
  if (me.permissions.includes("board.update")) {
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
/**
 * O texto digitado confere com o nome do quadro?
 *
 * ⚠️ E A UNICA TRAVA ENTRE UM CLIQUE E APAGAR AS TAREFAS DE OUTRAS PESSOAS.
 * Apagar quadro nao pergunta o destino delas -- diferente de apagar coluna,
 * que sempre pergunta --, e nao ha desfazer no produto: o resgate e um script
 * rodado no banco.
 *
 * ⚠️ SENSIVEL A MAIUSCULA, de proposito. A confirmacao existe para obrigar a
 * pessoa a LER o nome do quadro que ela esta prestes a apagar; aceitar
 * "quadro crm" para "Quadro CRM" afrouxaria justamente o passo que faz ela
 * olhar. E e a mesma regra do nome unico (fatia 9): "Backlog" e "backlog" sao
 * nomes diferentes neste produto.
 *
 * ⚠️ `trim` NAS DUAS PONTAS porque o backend grava com `strip()` -- um espaco
 * colado junto do nome nao pode virar recusa que a pessoa nao consegue ver.
 *
 * ⚠️ NOME VAZIO NUNCA CONFERE, mesmo que o quadro tivesse nome vazio (nao tem
 * -- `_nome_valido` recusa). Sem esta linha, abrir o dialogo e clicar em
 * confirmar sem digitar nada apagaria o quadro.
 */
export function nomeConfere(digitado: string, nomeDoQuadro: string): boolean {
  const limpo = digitado.trim();
  return limpo.length > 0 && limpo === nomeDoQuadro.trim();
}

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
  /**
   * ⚠️ AUSENTE, E NAO DESABILITADA, pela mesma razao de `podeRenomear` -- e
   * aqui a razao pesa mais: apagar quadro apaga as tarefas dentro, e e a
   * unica operacao do produto que nao pergunta o destino delas.
   *
   * ⚠️ `false` NA LENTE SEMPRE (nao ha registro para apagar) e no QUADRO
   * PADRAO -- que nem chega a esta lista, porque `opcoesDoSeletor` filtra
   * `!q.is_default`. O backend recusa com `quadro_padrao_nao_apagavel`; isto
   * so evita oferecer.
   */
  readonly podeApagar: boolean;
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
      // ⚠️ E NEM APAGAR, pelo mesmo motivo -- e o Quadro geral tambem nao
      // aparece aqui: o filtro acima e `!q.is_default`.
      podeApagar: false,
    },
    ...avulsos.map((q) => ({
      id: q.id,
      nome: q.name,
      podeRenomear: podeGerir,
      podeApagar: podeGerir,
    })),
  ];
}

/**
 * As opcoes do seletor DA RAIZ (Spec 036, fatia 5c).
 *
 * ⚠️ NAO E O `opcoesDoSeletor` COM OUTRO `teamId`, E A DIFERENCA E DE MODELO.
 * Na tela de um subtime, o primeiro item e a LENTE -- que nao existe no banco,
 * e por isso o `opcoesDoSeletor` filtra `!q.is_default`: o Quadro geral ja esta
 * representado por ela. **Na raiz nao ha lente.** O que a lente espelha E o
 * Quadro geral, e na tela dele a coisa e ela mesma.
 *
 * ⚠️ LOGO O PRIMEIRO ITEM E O QUADRO GERAL, PELO NOME DELE, e com `id`
 * de verdade -- nao `null`. Reaproveitar o `id: null` da lente aqui faria a
 * tela do Quadro geral se comportar como espelho de si mesma, e o
 * `quadroPedidoNaUrl` o recusaria como `is_default`.
 *
 * ⚠️ E ELE NUNCA PODE SER APAGADO (`quadro_padrao_nao_apagavel`), nem quando
 * quem olha e ADMIN. Renomear PODE -- `board_service.py` diz "O QUADRO GERAL
 * PODE SER RENOMEADO", e ate a fatia 5c isso nao tinha caminho de tela.
 */
export function opcoesDoSeletorDaRaiz(
  quadros: readonly Quadro[],
  rootTeamId: string,
  podeGerir: boolean,
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
            // ⚠️ FALSO SEMPRE. O backend recusa com `quadro_padrao_nao_apagavel`,
            // e a ADR 0034 item 2 manda a afordancia ser AUSENTE, nao
            // desabilitada.
            podeApagar: false,
          },
        ]
      : []),
    ...avulsos.map((q) => ({
      id: q.id,
      nome: q.name,
      podeRenomear: podeGerir,
      podeApagar: podeGerir,
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
  return resolverQuadroPedido(parametro, quadros, teamId).id;
}

/**
 * Por que o `?quadro=` da URL nao virou o quadro desenhado (Spec 036, fatia 11).
 *
 * ⚠️ `null` = NAO HA O QUE AVISAR. Cobre os dois casos silenciosos legitimos:
 * nao havia `?quadro=` nenhum, e o pedido foi ACEITO.
 */
export type MotivoDaQueda =
  /**
   * O id nao esta na lista que a pessoa alcanca.
   *
   * ⚠️ TRES CAUSAS INDISTINGUIVEIS DAQUI, e juntar as tres e a decisao: o
   * quadro foi APAGADO por outra pessoa, o id nunca existiu (link velho, texto
   * digitado na mao), ou ele existe e esta fora do alcance de quem pergunta.
   * A lista de quadros nao sabe diferenciar -- e, para quem esta olhando, a
   * acao e a mesma nos tres. Inventar tres mensagens seria fingir uma precisao
   * que o dado nao tem.
   */
  | "fora-de-alcance"
  /**
   * O quadro existe e a pessoa alcanca, mas ele e de OUTRO time.
   *
   * ⚠️ ESTE MERECE MENSAGEM PROPRIA porque tem conserto: a pessoa esta na
   * pagina errada, e nao diante de algo que sumiu. Acontece com link colado
   * entre paginas de times diferentes.
   */
  | "outro-time"
  /**
   * O id aponta para o quadro PADRAO (o Quadro geral).
   *
   * ⚠️ Ele nunca entra no seletor (`opcoesDoSeletor` filtra `!q.is_default`),
   * porque quem o representa nesta tela e a LENTE. Pedir por ele nao e erro --
   * e pedir pelo lugar onde a pessoa ja esta.
   */
  | "e-o-quadro-geral";

export type QuadroPedido = {
  /** O id a desenhar, ou `null` para a lente. */
  readonly id: string | null;
  /** `null` = nada a dizer. Ver `MotivoDaQueda`. */
  readonly motivo: MotivoDaQueda | null;
};

/**
 * A versao que DIZ POR QUE, e a razao de ela existir (fatia 11).
 *
 * ⚠️ ATE AQUI A QUEDA ERA MUDA, E ERA CERTO ASSIM. O docstring do
 * `quadroPedidoNaUrl` explicava: link velho ou id digitado na mao nao merecem
 * erro na cara de quem so abriu a tela. **A fatia 7 mudou o mundo**: agora uma
 * pessoa APAGA o quadro que a outra tem aberto, e a tela da segunda troca de
 * lugar sozinha. Silencio, ali, e indistinguivel de defeito.
 *
 * ⚠️ E O CASO DEIXOU DE SER HIPOTETICO EM 18/08: existe quadro avulso em
 * producao, e um ja foi apagado ("Cobertura e captacoes", consulta 5).
 *
 * ⚠️ `quadros === null` NAO PRODUZ MOTIVO, e essa e a linha mais importante
 * desta funcao. `null` e "a lista ainda nao chegou" -- avisar ali poria "este
 * quadro nao esta aqui" na tela de TODO carregamento, por um instante, antes
 * de o quadro aparecer normalmente. O aviso piscaria em quem nao tem problema
 * nenhum.
 */
export function resolverQuadroPedido(
  parametro: string | null | undefined,
  quadros: readonly Quadro[] | null,
  teamId: string,
): QuadroPedido {
  if (!parametro) return { id: null, motivo: null };
  // ⚠️ Ainda carregando: devolve o pedido SEM conferir e SEM motivo. Ver acima.
  if (quadros === null) return { id: parametro, motivo: null };

  const achado = quadros.find((q) => q.id === parametro);
  if (!achado) return { id: null, motivo: "fora-de-alcance" };
  if (achado.is_default) return { id: null, motivo: "e-o-quadro-geral" };
  if (achado.team_id !== teamId) return { id: null, motivo: "outro-time" };
  return { id: parametro, motivo: null };
}

/**
 * O texto que a tela mostra para cada motivo.
 *
 * ⚠️ MORA EM `lib/`, e nao no componente, pelo mesmo motivo do resto deste
 * arquivo: e decisao de produto (o que a pessoa le), e o `include` do vitest
 * so alcanca `lib/**` e `components/**`.
 */
export const TEXTO_DA_QUEDA: Record<MotivoDaQueda, string> = {
  "fora-de-alcance":
    "O quadro que você pediu não está mais aqui — ele pode ter sido apagado, " +
    "ou o link pode estar velho. Mostrando a lente do time.",
  "outro-time":
    "Esse quadro é de outro time. Mostrando a lente deste time.",
  "e-o-quadro-geral":
    "Esse é o Quadro geral, e a lente do time já é o espelho dele.",
};

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
