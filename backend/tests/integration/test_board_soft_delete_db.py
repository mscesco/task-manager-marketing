"""`board.deleted_at` (migration `0012`, ADR 0034 D9).

A coluna nasce ANTES da tela de apagar quadro, e por isso estes testes apagam
o quadro **na mao** — não existe caminho de produto que faça isso ainda. Não é
o estado partido que a factory recusa montar (aquele a FK aceita e o produto
proíbe); é o estado que a F5 vai produzir de propósito, montado cedo para o
`GET /boards` (F3) já nascer com o filtro e com teste que pode falhar.

⚠️ O QUE ESTES TESTES **NÃO** PROVAM: que apagar quadro apaga as tarefas
junto. Isso é a F5. Aqui só se prova que a coluna existe, que o ORM a enxerga,
e que a consulta que DESCOBRE quadro respeita o filtro.
"""

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
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _apagar(db, board_id: uuid.UUID) -> None:
    """Soft delete na mão. Não existe caminho de produto (F5)."""
    quadro = (
        await db.execute(select(Board).where(Board.id == board_id))
    ).scalar_one()
    quadro.deleted_at = dt.datetime.now(dt.UTC)
    await db.flush()


# 1 -- a coluna existe e o ORM a enxerga. Trava contra a migration não ter
#      sido aplicada: sem ela este teste falha com ProgrammingError na
#      primeira leitura, e não com um assert enigmático mais adiante.
async def test_board_nasce_com_deleted_at_nulo(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)

    quadro = (
        await db.execute(
            select(Board).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalar_one()

    assert quadro.deleted_at is None
    assert quadro.is_deleted is False


# 2 -- apagar e ler de volta. Prova que o `SoftDeleteMixin` está de fato no
#      `Board` e não só na migration.
async def test_deleted_at_grava_e_le(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)

    await _apagar(db, interno.id)
    await db.refresh(interno)

    assert interno.deleted_at is not None
    assert interno.is_deleted is True


# 3 -- ⚠️ O QUE IMPORTA. A consulta que DESCOBRE o quadro geral ignora quadro
#      apagado. Sem o `AND b.deleted_at IS NULL` ela devolveria o quadro
#      apagado e a tarefa nova nasceria dentro dele — invisível, e sem erro.
async def test_quadro_apagado_nao_e_descoberto_como_quadro_geral(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN")

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
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz),),
    )

    # antes de apagar, a consulta responde normalmente
    with acting_as(**ctx):
        board_id, _coluna = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG)
    assert board_id == geral

    await _apagar(db, geral)

    # depois de apagar, o workspace passa a NÃO ter quadro geral -- e o
    # repositório levanta, alto, em vez de devolver o quadro apagado.
    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await BoardRepository(db).default_board_and_column_for_status(
                TaskStatus.BACKLOG
            )


# 4 -- apagar um quadro NÃO-padrão não afeta a descoberta do geral. Trava
#      contra um filtro escrito largo demais (por exemplo, um `NOT EXISTS`
#      sobre a tabela inteira em vez do filtro na linha do quadro).
async def test_apagar_quadro_interno_nao_afeta_o_geral(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN")
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
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz), node(sub, raiz)),
    )
    with acting_as(**ctx):
        board_id, _coluna = await BoardRepository(
            db
        ).default_board_and_column_for_status(TaskStatus.BACKLOG)

    assert board_id == geral
