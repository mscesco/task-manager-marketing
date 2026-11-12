"""`board.deleted_at`: a coluna existe, o ORM a enxerga e a descoberta do
quadro geral ignora quadro apagado. Os testes apagam o quadro na mao."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy import select

from app.db.models.boards import Board
from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _apagar(db, board_id: uuid.UUID) -> None:
    quadro = (
        await db.execute(select(Board).where(Board.id == board_id))
    ).scalar_one()
    quadro.deleted_at = dt.datetime.now(dt.UTC)
    await db.flush()


async def test_board_nasce_com_deleted_at_nulo(db) -> None:
    ws = await f.make_workspace(db)
    await f.make_team(db, workspace_id=ws)

    quadro = (
        await db.execute(
            select(Board).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalar_one()

    assert quadro.deleted_at is None
    assert quadro.is_deleted is False


async def test_deleted_at_grava_e_le(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)

    await _apagar(db, interno.id)
    await db.refresh(interno)

    assert interno.deleted_at is not None
    assert interno.is_deleted is True


# Sem o filtro a tarefa nova nasceria no quadro apagado, invisivel.
async def test_quadro_apagado_nao_e_descoberto_como_quadro_geral(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")

    geral = (
        await db.execute(
            select(Board.id).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalar_one()

    ctx = dict(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(raiz),),
    )

    with acting_as(**ctx):
        board_id, _coluna = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG, root_team_id=raiz)
    assert board_id == geral

    await _apagar(db, geral)

    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await BoardRepository(db).default_board_and_column_for_status(
                TaskStatus.BACKLOG, root_team_id=raiz
            )


# Trava contra um filtro largo demais (sobre a tabela, e nao na linha do quadro).
async def test_apagar_quadro_interno_nao_afeta_o_geral(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)

    geral = (
        await db.execute(
            select(Board.id).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalar_one()

    await _apagar(db, interno.id)

    ctx = dict(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(raiz), node(sub, raiz)),
    )
    with acting_as(**ctx):
        board_id, _coluna = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG, root_team_id=raiz)

    assert board_id == geral
