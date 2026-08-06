"""Leitura de quadro e coluna (Spec 035 fatia 3b, ADR 0032/0033; F2 em 06/08).

Duas perguntas, e a diferenca entre elas e a fatia F2 inteira:

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
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.enums import TaskStatus
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
