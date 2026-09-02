"""Leitura de quadro e coluna (Spec 035 fatia 3b, ADR 0032/0033; F2 em 06/08).

⚠️ DESDE A FATIA 2 DA SPEC 036 sao TRES perguntas -- a terceira, `list_visible`,
esta no fim do arquivo e e a unica com superficie de API.

Duas perguntas herdadas da Spec 035, e a diferenca entre elas e a F2 inteira:

  - **"em que quadro nasce uma tarefa nova de topo?"**
    `default_board_and_column_for_status` -- o quadro geral, do time RAIZ.
  - **"qual e a coluna deste status DENTRO deste quadro?"**
    `coluna_para_status` -- nao escolhe quadro nenhum, so responde.

⚠️ A DIRECAO E `status -> coluna`, e nao o contrario (ADR 0033). Enquanto o
front desenha o quadro pela lista de `web/lib/status.ts`, `status` e a fonte da
verdade. `board_column.legacy_status` e a ponte que torna essa derivacao 1:1 --
sem ela, so sobraria casar por nome (quebra no primeiro rename) ou pela
semantica (8:4, apaga quatro status).

⚠️ ATE A F2 EXISTIA UM METODO SO, e ele cravava o quadro do time raiz no SQL.
Estava certo enquanto havia um quadro so, e passa a estar errado no dia do
segundo. Os dois caminhos que dependiam dele erram de formas DIFERENTES, e
essa assimetria e o motivo de a fatia vir antes do quadro interno, e nao junto:

  - **edicao de status**: o `board_id` fica e so a coluna muda. O par
    `(coluna do quadro geral, board interno)` nao existe, entao a FK composta
    `(column_id, board_id)` RECUSA -- erro alto ao salvar. Ruim, mas visivel.
  - **subtarefa**: nasceria com `board_id` do geral E coluna do geral. O par e
    internamente consistente, a FK ACEITA, e o resultado e pai num quadro e
    filha em outro. Este e o silencioso, e e o que a F2 fecha no `create`.

⚠️ ONDE O FILTRO `deleted_at IS NULL` VALE, e onde nao vale (desde a `0012`).
Este repositorio NAO estende `BaseRepository`, entao o filtro automatico de
soft delete nao chega aqui: cada consulta decide. A regra e:

  **consulta que DESCOBRE um quadro filtra; consulta que RECEBE o `board_id`
  nao filtra.**

`default_board_and_column_for_status` descobre -- ela responde "qual e o quadro
geral deste workspace" -- entao filtra. `coluna_para_status` recebe o
`board_id` de quem ja resolveu o quadro (a propria tarefa, ou o pai) e so
pergunta a coluna; um `JOIN` em `board` ali seria custo no caminho mais quente
do produto (`create` de tarefa, chamado uma vez por no na duplicacao) para
proteger um estado que a ADR 0034 ja impede: apagar quadro apaga as tarefas
dentro, entao tarefa viva em quadro apagado nao existe.

⚠️ ESSE "nao existe" e uma INVARIANTE, nao uma garantia do banco -- nenhuma
constraint a sustenta. Ela e medida pela consulta 4 de
`backend/scripts/invariantes.sql`. Se ela um dia der diferente de zero, o
conserto e o dado, e nao acrescentar o `JOIN` aqui.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.board_semantics import (
    semantica_do_status,
    status_da_coluna,
)
from app.shared.exceptions.base import ValidationError


class BoardRepository:
    """Consultas de quadro. Sem escrita -- quem cria quadro e o BoardService."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def default_board_and_column_for_status(
        self, status: TaskStatus
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Devolve `(board_id, column_id)` do quadro GERAL para aquele status.

        So para tarefa que nasce SEM PAI. Subtarefa herda o quadro do pai e usa
        `coluna_para_status` -- ver o cabecalho do modulo.

        UMA query, e nao duas. O `create` de tarefa e chamado em sequencia pela
        duplicacao (uma vez por no da arvore), e a Spec 021 ja mediu o custo de
        "duas queries por membro" como a parede de desempenho deste produto.

        ⚠️ O quadro e o do time RAIZ (`parent_team_id IS NULL`), e nao o do time
        da tarefa. E a decisao da ADR 0032, tomada com dado: 86% das tarefas
        vivas estao na raiz, e a decisao B da 0030 (uma tarefa vive num quadro
        so) obrigaria a escolher em qual quadro apareceriam as da raiz, que todo
        mundo alcanca. O JOIN em `team` e o que torna isso explicito: filtrar
        so por `is_default` daria a resposta certa hoje e a errada no dia em que
        um subtime tiver quadro proprio -- e a resposta errada nao aparece na
        tela, aparece na tarefa que foi parar no quadro de outro time.

        Levanta `ValidationError` se nao houver quadro ou se o status nao tiver
        coluna. Nao ha fallback DE PROPOSITO: cair para "a primeira coluna que
        achar" gravaria a tarefa na coluna errada em silencio, que e o defeito
        que esta spec inteira existe para evitar. Falhar aqui e alto, visivel e
        consertavel; falhar fechado nao seria nenhum dos tres.

        ⚠️ `b.deleted_at IS NULL` desde a `0012`. Esta consulta DESCOBRE um
        quadro, entao ela filtra -- ver a regra no cabecalho do modulo.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT b.id, c.id
                    FROM board b
                    JOIN team t
                      ON t.id = b.team_id
                     AND t.workspace_id = b.workspace_id
                     AND t.parent_team_id IS NULL
                    JOIN board_column c
                      ON c.board_id = b.id
                     AND c.legacy_status = CAST(:status AS task_status)
                    WHERE b.workspace_id = :ws
                      AND b.is_default
                      AND b.deleted_at IS NULL
                    """
                ),
                {"ws": tenant.workspace_id, "status": status.value},
            )
        ).first()

        if linha is None:
            raise ValidationError(
                "Este workspace nao tem quadro para o status "
                f"{status.value}. Workspace criado antes da Spec 035 fatia 3a "
                "nasceu sem quadro -- rodar a migration 0011.",
                details={"field": "status", "status": status.value},
            )
        return linha[0], linha[1]

    async def coluna_para_status(
        self, *, board_id: uuid.UUID, status: TaskStatus
    ) -> tuple[uuid.UUID, TaskStatus]:
        """Devolve `(column_id, status_efetivo)` daquele status DENTRO de `board_id`.

        ⚠️ CHAMAVA-SE `column_for_status_in_board` E DEVOLVIA SO A COLUNA. O
        rename e deliberado, e nao e cosmetico: quem chamava gravava
        `command.status` por conta propria, e com a ADR 0042 esse status pode
        NAO ser o que a tarefa recebe. Mantendo o nome e acrescentando um item
        na tupla, um chamador esquecido continuaria compilando e gravaria o
        status pedido numa coluna que significa outra coisa -- silencioso, e
        com a invariante 3 do `invariantes.sql` quebrando dias depois. Trocar o
        nome obriga a visitar os dois chamadores.

        ⚠️ NAO ESCOLHE QUADRO. Quem chama ja sabe em qual quadro a tarefa vive
        (o dela, na edicao; o do pai, na subtarefa) e so pergunta a coluna. E a
        diferenca inteira em relacao a `default_board_and_column_for_status`:
        "mudar de status" e "mudar de quadro" sao operacoes distintas no
        codigo, como sempre foram no produto.

        ⚠️ DOIS DEGRAUS, NESTA ORDEM (ADR 0042 D1), E A ORDEM E A DECISAO
        INTEIRA:

          1. coluna com `legacy_status = :status` -> e ela. Exato, sem perda.
             Cobre as oito colunas padrao, que sao 100% da producao hoje.
          2. nao achando: coluna com `is_default_target` e a semantica daquele
             status -> e ela. E o caso do quadro criado por pessoa, que nasce
             com quatro colunas (`COLUNAS_BASE`) e nao conhece `PLANNED`,
             `IN_REVIEW`, `EXTERNAL_APPROVAL` nem `BLOCKED`.
          3. nao achando nenhuma das duas: `ValidationError`, como antes.

        ⚠️ INVERTER OS DEGRAUS POE A TAREFA NA COLUNA ERRADA, e o resultado e
        um estado VALIDO: uma tarefa `EXTERNAL_APPROVAL` no Quadro geral para
        em `Em Andamento` -- coluna do quadro certo, com a semantica certa.
        Nenhuma FK recusa, nenhum tipo reclama; o card so aparece no lugar
        errado na tela de todo mundo depois do deploy.

        ⚠️ MEDIDO EM 11/08, e o resultado corrigiu o que estava escrito aqui.
        A inversao derruba CINCO testes, e tres deles sao desta fatia:

          - `test_o_degrau_exato_vem_antes_do_alvo_da_semantica`
          - `test_as_oito_colunas_padrao_nunca_alcancam_o_degrau_dois`
          - `test_coluna_sem_ponte_nao_ganha_do_casamento_exato`
          - `test_external_approval_status_db::test_patch_para_external_approval_persiste`
          - `test_task_board_column_db::test_mudar_o_status_MOVE_a_coluna_e_nao_muda_o_quadro`

        Os dois ultimos sao ANTERIORES a esta ADR e cobrem o caminho de
        produto, nao o repositorio. Esta funcao chegou a ter escrito aqui que
        nenhum outro portao pegava a inversao -- era falso, e afirmacao de
        unicidade em comentario e o que faz alguem apagar um teste "redundante"
        seis meses depois. Se um dia sobrar so um destes cinco, a trava
        afinou.

        ⚠️ O `status_efetivo` SAI DA COLUNA QUE RECEBEU, sempre -- inclusive no
        degrau 1, onde por construcao ele e igual ao pedido. Nao ha ramo: e
        `status_da_coluna()` da ADR 0041, a MESMA funcao usada quando a escrita
        vem por `column_id`. Uma regra so, um lugar so. E o que sustenta a
        invariante 3 (`a coluna e a do status certo, so onde existe a ponte`):
        sem a reescrita, uma tarefa `BLOCKED` numa coluna cujo `legacy_status`
        e `IN_PROGRESS` poe a invariante em diferente de zero.

        ⚠️ UMA QUERY, e nao duas. O `create` de tarefa e chamado uma vez por no
        na duplicacao, e a Spec 021 ja mediu "duas queries por membro" como a
        parede de desempenho deste produto. O `ORDER BY` e que ordena os
        degraus.

        ⚠️ `DESC NULLS LAST` NAO E ENFEITE. `legacy_status = :status` e NULL
        (nao FALSE) para coluna criada por gente, e o Postgres poe NULL PRIMEIRO
        num `ORDER BY ... DESC`. Sem o `NULLS LAST`, uma coluna sem ponte
        ganharia do casamento exato e o degrau 2 comeria o degrau 1 -- que e
        exatamente a inversao descrita acima, so que por acidente de SQL.

        ⚠️ ESTA E A TRAVA MAIS FINA DA FATIA, e medida: tirar so o `NULLS LAST`
        derruba UM teste em 681, `test_coluna_sem_ponte_nao_ganha_do_casamento_
        exato`. Ele e o unico mundo do repositorio com coluna sem ponte marcada
        como `is_default_target`. Apagar aquele teste devolve o defeito ao
        silencio completo.

        `board_id` e `workspace_id` juntos no WHERE. O `board_id` sozinho ja
        bastaria -- o quadro pertence a um workspace so -- mas o par e o padrao
        do schema e o que impede que uma consulta futura, copiada daqui, cruze
        tenant sem ninguem notar.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT c.id, c.legacy_status, c.semantic
                    FROM board_column c
                    WHERE c.board_id = :board
                      AND c.workspace_id = :ws
                      AND (
                        c.legacy_status = CAST(:status AS task_status)
                        OR (
                          c.is_default_target
                          AND c.semantic = CAST(:semantica AS column_semantic)
                        )
                      )
                    ORDER BY (c.legacy_status = CAST(:status AS task_status))
                             DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {
                    "board": board_id,
                    "ws": tenant.workspace_id,
                    "status": status.value,
                    "semantica": semantica_do_status(status).value,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                f"O quadro desta tarefa nao tem coluna para o status "
                f"{status.value}, nem coluna de destino para a semantica "
                f"{semantica_do_status(status).value}.",
                details={
                    "field": "status",
                    "status": status.value,
                    "board_id": str(board_id),
                },
            )

        # ⚠️ `text()` DEVOLVE A COLUNA CRUA DO DRIVER -- string, nao enum. Sem
        # esta conversao, `coluna_para_status` devolve `'IN_PROGRESS'` em vez
        # de `TaskStatus.IN_PROGRESS`, e o valor vai parar em `task.status`.
        # `TaskStatus` e `ColumnSemantic` sao `StrEnum`, entao `==` continua
        # respondendo certo e o defeito NAO aparece em quase lugar nenhum: some
        # em toda comparacao do produto e so reaparece num `is`. E o
        # `STATUS_POR_SEMANTICA[semantica]` do degrau 2 tambem acerta -- por
        # coincidencia, porque `name == value` nos dois enums. Coincidencia nao
        # e contrato.
        #
        # ⚠️ MESMA CONVERSAO DE `coluna_no_quadro`, tres metodos abaixo, escrita
        # na 5a. Este metodo e o unico do repositorio que devolvia enum sem
        # converter.
        ponte, semantica = linha[1], linha[2]
        return linha[0], status_da_coluna(
            legacy_status=TaskStatus(ponte) if ponte is not None else None,
            semantic=ColumnSemantic(semantica),
        )

    async def coluna_no_quadro(
        self, *, board_id: uuid.UUID, column_id: uuid.UUID
    ) -> tuple[TaskStatus | None, ColumnSemantic]:
        """A PONTE e a SEMANTICA de uma coluna, exigindo que ela seja DAQUELE
        quadro (Spec 036, fatia 5 / ADR 0041).

        ⚠️ E A PERGUNTA INVERSA de `coluna_para_status`, e existe pelo
        mesmo motivo que ela: quem chama ja sabe o quadro (o da tarefa) e so
        quer saber o que aquela coluna significa. A direcao `coluna -> status`
        so passou a existir porque o front vai mandar `column_id` ao arrastar.

        ⚠️ O `board_id` NO WHERE E A VALIDACAO INTEIRA. Sem ele, um `column_id`
        de OUTRO quadro seria aceito aqui e recusado la embaixo pela FK
        composta `(column_id, board_id)` -- erro de banco, 500, em vez de um
        422 dizendo o que aconteceu. `workspace_id` entra junto pelo mesmo
        motivo do metodo acima: e o padrao do schema, e impede que uma consulta
        copiada daqui cruze tenant.

        ⚠️ NAO FILTRA `deleted_at`, e e a regra do topo deste arquivo: esta
        consulta RECEBE o `board_id` de quem ja resolveu o quadro (a propria
        tarefa), nao DESCOBRE quadro nenhum.

        Levanta `ValidationError` quando a coluna nao e daquele quadro -- o que
        inclui o caso de ela nao existir. Os dois sao a mesma resposta de
        propósito: dizer "essa coluna existe, mas nao aqui" vaza a existencia
        de coluna de quadro que quem pergunta talvez nem alcance.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT c.legacy_status, c.semantic
                    FROM board_column c
                    WHERE c.id = :coluna
                      AND c.board_id = :board
                      AND c.workspace_id = :ws
                    """
                ),
                {
                    "coluna": column_id,
                    "board": board_id,
                    "ws": tenant.workspace_id,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                "A coluna informada nao pertence ao quadro desta tarefa.",
                details={
                    "field": "column_id",
                    "column_id": str(column_id),
                    "board_id": str(board_id),
                },
            )

        ponte, semantica = linha
        return (
            TaskStatus(ponte) if ponte is not None else None,
            ColumnSemantic(semantica),
        )

    async def dono_do_quadro(
        self, board_id: uuid.UUID
    ) -> tuple[uuid.UUID, bool] | None:
        """`(team_id, is_default)` do quadro -- ou `None` se ele nao existe.

        ⚠️ EXISTE PARA A TRAVA DE TIME DA TAREFA (Spec 036, fatia 8): dentro de
        quadro AVULSO, o time da tarefa tem de ser o time do quadro. No Quadro
        geral o time continua livre, e e isso que sustenta as tarefas INTERNAS
        de subtime -- 216 delas em producao, medidas em 18/08. Por isso a
        resposta traz `is_default` junto: sem ele quem chama teria de fazer a
        segunda consulta, ou pior, adivinhar.

        ⚠️ NAO FILTRA `deleted_at`, e e a regra do topo deste arquivo: esta
        consulta RECEBE o `board_id` de quem ja resolveu o quadro, e nao
        DESCOBRE quadro nenhum. Filtrar aqui faria a trava sumir em silencio
        para um quadro apagado -- e a tarefa dentro dele passaria livre, que e
        o oposto do que a trava existe para fazer.

        ⚠️ `None` E "NAO EXISTE", e nao "sem permissao". Quem chama decide o que
        fazer: no `create` o `_assert_board_in_reach` ja recusou antes; no
        `update` a tarefa carrega um `board_id` que o banco garante existir
        (FK), entao `None` ali seria dado corrompido, e deixar passar e melhor
        que estourar num caminho de PATCH que nao e sobre quadro.
        """
        linha = (
            await self.session.execute(
                select(Board.team_id, Board.is_default).where(
                    Board.id == board_id,
                    Board.workspace_id == require_tenant().workspace_id,
                )
            )
        ).first()
        return (linha.team_id, linha.is_default) if linha else None

    async def list_visible(self) -> list[tuple[Board, list[BoardColumn]]]:
        """Quadros que o usuario do contexto ALCANCA, com as colunas de cada.

        Spec 036 fatia 2. Leitura pura -- nao cria, nao altera, nao apaga.

        ⚠️ A LENTE E A MESMA DO RESTO DO APP (`visible_team_ids`), e isso e
        decisao registrada, nao economia. A ADR 0035 (D3) confirma a 0030: a
        visibilidade do quadro sai de graca do `team_id` dele, sem eixo novo e
        sem permissao por quadro. `None` = ADMIN = todos os TIMES.

        ⚠️ `None` NAO SIGNIFICA "SEM FILTRO". Significa "sem filtro de TIME".
        O `workspace_id` entra SEMPRE, fora do `if`, e essa e a linha que
        separa "o ADMIN ve todos os quadros da casa dele" de "o ADMIN ve os
        quadros da casa dos outros". O defeito, se existisse, apareceria SO
        para o ADMIN -- com a lente restrita, o filtro por `team_id` barraria
        o quadro de outro workspace por tabela e esconderia o furo. E por isso
        que `test_quadro_de_outro_workspace_nunca_aparece` roda como ADMIN.

        ⚠️ `deleted_at IS NULL` porque esta consulta DESCOBRE quadro -- a regra
        do cabecalho do modulo. Ela e o segundo leitor da coluna criada pela
        `0012`, e o primeiro que uma pessoa ve na tela.

        ⚠️ DUAS QUERIES, de proposito, e aqui isso NAO e defeito. `Board` nao
        declara `relationship` para `BoardColumn` (o schema usa FK composta e
        o repo nunca precisou), entao `selectinload` nao esta disponivel. Um
        JOIN unico devolveria o quadro repetido uma vez por coluna e exigiria
        agrupar na aplicacao. A segunda query e um `IN` sobre poucos ids, num
        caminho que NAO e quente: a listagem roda uma vez por abertura de tela,
        nao uma vez por no de arvore como o `create`. Se um dia o numero de
        quadros justificar, o lugar de medir e aqui, com o numero na mao.

        Devolve lista de `(quadro, colunas)`, colunas ja ordenadas por
        `position` -- a ordem VISUAL do quadro, que e o que a fatia 4 desenha.
        Quadro sem coluna nenhuma volta com lista vazia em vez de sumir: sumir
        esconderia um quadro defeituoso da unica tela que poderia denuncia-lo.
        """
        tenant = require_tenant()
        visiveis = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )  # None = ADMIN (sem filtro de TIME -- ver o aviso acima)

        consulta = (
            select(Board)
            .where(Board.workspace_id == tenant.workspace_id)
            .where(Board.deleted_at.is_(None))
            .order_by(Board.is_default.desc(), Board.name)
        )
        if visiveis is not None:
            consulta = consulta.where(Board.team_id.in_(visiveis))

        quadros = list((await self.session.execute(consulta)).scalars().all())
        if not quadros:
            return []

        ids = [q.id for q in quadros]
        colunas = list(
            (
                await self.session.execute(
                    select(BoardColumn)
                    .where(BoardColumn.workspace_id == tenant.workspace_id)
                    .where(BoardColumn.board_id.in_(ids))
                    .order_by(BoardColumn.board_id, BoardColumn.position)
                )
            )
            .scalars()
            .all()
        )

        por_quadro: dict[uuid.UUID, list[BoardColumn]] = {i: [] for i in ids}
        for coluna in colunas:
            por_quadro[coluna.board_id].append(coluna)

        return [(q, por_quadro[q.id]) for q in quadros]
