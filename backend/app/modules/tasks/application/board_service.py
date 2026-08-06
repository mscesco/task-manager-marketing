"""Criacao do quadro geral de um workspace (Spec 035 fatia 3a, ADR 0032).

⚠️ UM quadro por workspace, do time RAIZ. Nao um por time. A ADR 0032 fechou
essa contradicao com dado: 495 das 576 tarefas vivas estao na raiz (86%), seis
subtimes somam 81 e um nao tem nenhuma. Oito conjuntos de colunas para manter
sincronizados cobririam 14% do trabalho -- e a decisao B da 0030 (uma tarefa
vive num quadro so) obrigaria a escolher em qual quadro aparecem as 495 da
raiz, que todo mundo alcanca.

⚠️ `TeamService.create` NAO chama isto, e nao e esquecimento. Subtime nao ganha
quadro por existir; quadro de subtime e o personalizado, criado por gente
(`board.manage.subteam`, ADR 0030), e e spec seguinte.
"""

from __future__ import annotations

import uuid

import structlog

from app.db.models.boards import Board, BoardColumn
from app.modules.tasks.domain.board_defaults import (
    COLUNAS_PADRAO,
    NOME_QUADRO_GERAL,
)

logger = structlog.get_logger(__name__)


class BoardService:
    """Cria o quadro geral. Sem CRUD de coluna -- isso e spec seguinte (D10)."""

    def __init__(self, session) -> None:
        self._session = session

    async def create_default_board(
        self, *, workspace_id: uuid.UUID, team_id: uuid.UUID
    ) -> Board:
        """Cria o quadro do time raiz com as colunas padrao.

        ⚠️ NAO faz commit -- quem commita e o chamador, na mesma unidade de
        trabalho do provisionamento. Se o quadro falhasse fora da transacao do
        workspace, nasceria um workspace sem quadro: exatamente o estado que a
        `0011` vai ter de consertar para os workspaces criados entre a `0008` e
        esta fatia.

        ⚠️ Nao e idempotente de proposito. O indice parcial
        `board_um_padrao_por_time` recusa o segundo quadro padrao do mesmo time
        NO BANCO. Engolir isso aqui com um "se ja existe, retorna" esconderia a
        chamada duplicada, que e defeito de quem chama.
        """
        quadro = Board(
            workspace_id=workspace_id,
            team_id=team_id,
            name=NOME_QUADRO_GERAL,
            is_default=True,
        )
        self._session.add(quadro)
        await self._session.flush()  # precisa do id para as colunas

        for posicao, coluna in enumerate(COLUNAS_PADRAO):
            self._session.add(
                BoardColumn(
                    workspace_id=workspace_id,
                    board_id=quadro.id,
                    name=coluna.nome,
                    color=coluna.cor,
                    position=posicao,
                    semantic=coluna.semantica,
                    notify_deadline=coluna.notify_deadline,
                    is_default_target=coluna.is_default_target,
                    legacy_status=coluna.legacy_status,
                )
            )
        await self._session.flush()

        logger.info(
            "board.created",
            board_id=str(quadro.id),
            team_id=str(team_id),
            colunas=len(COLUNAS_PADRAO),
        )
        return quadro
