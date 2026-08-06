"""Leitura de quadro e coluna (Spec 035 fatia 3b, ADR 0032/0033; F2 em 06/08).

⚠️ DESDE A FATIA 2 DA SPEC 036 sao TRES perguntas -- a terceira, `list_visible`,
esta no fim do arquivo e e a unica com superficie de API.

Duas perguntas herdadas da Spec 035, e a diferenca entre elas e a F2 inteira:

  - **"em que quadro nasce uma tarefa nova de topo?"**
    `default_board_and_column_for_status` -- o quadro geral, do time RAIZ.
  - **"qual e a coluna deste status DENTRO deste quadro?"**
    `column_for_status_in_board` -- nao escolhe quadro nenhum, so responde.

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
geral deste workspace" -- entao filtra. `column_for_status_in_board` recebe o
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
from app.db.models.enums import TaskStatus
from app.modules.auth.domain import team_scope
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
        `column_for_status_in_board` -- ver o cabecalho do modulo.

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

    async def column_for_status_in_board(
        self, *, board_id: uuid.UUID, status: TaskStatus
    ) -> uuid.UUID:
        """Devolve o `column_id` daquele status DENTRO de `board_id`.

        ⚠️ NAO ESCOLHE QUADRO. Quem chama ja sabe em qual quadro a tarefa vive
        (o dela, na edicao; o do pai, na subtarefa) e so pergunta a coluna. E a
        diferenca inteira em relacao ao metodo acima: "mudar de status" e "mudar
        de quadro" passam a ser operacoes distintas no codigo, como sempre
        foram no produto.

        `board_id` e `workspace_id` juntos no WHERE. O `board_id` sozinho ja
        bastaria -- o quadro pertence a um workspace so -- mas o par e o padrao
        do schema e o que impede que uma consulta futura, copiada daqui, cruze
        tenant sem ninguem notar.

        ⚠️ LEVANTA quando a coluna nao existe naquele quadro, e isso vai
        acontecer de proposito no quadro interno: coluna criada por gente tem
        `legacy_status` NULL, entao um quadro com colunas proprias NAO responde
        por status. A derivacao pela SEMANTICA e o passo seguinte (D4 do memo
        de decisoes). Ate la, falhar alto e o que impede a tarefa de ser
        gravada numa coluna arbitraria -- que e o defeito que a Spec 035
        inteira existe para evitar.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT c.id
                    FROM board_column c
                    WHERE c.board_id = :board
                      AND c.workspace_id = :ws
                      AND c.legacy_status = CAST(:status AS task_status)
                    """
                ),
                {
                    "board": board_id,
                    "ws": tenant.workspace_id,
                    "status": status.value,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                f"O quadro desta tarefa nao tem coluna para o status "
                f"{status.value}.",
                details={
                    "field": "status",
                    "status": status.value,
                    "board_id": str(board_id),
                },
            )
        return linha[0]

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
            tenant.memberships, tenant.team_tree
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
