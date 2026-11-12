"""Quem a varredura de arquivamento escolhe (`list_stale_terminal`).

Elegivel: status terminal, nao arquivada, nao apagada e `terminal_since`
estritamente antes do limite. `NOW()` e constante dentro da transacao do `db`,
entao as datas sao plantadas a mao.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import Task
from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
DAYS = 20
CUTOFF = NOW - timedelta(days=DAYS)


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        org_role="ADMIN",
        team_tree=(node(team),),
    )
    return ws, team, admin, ctx


async def _plantar(
    db,
    *,
    ws: uuid.UUID,
    admin: uuid.UUID,
    team: uuid.UUID,
    status: TaskStatus,
    terminal_since: datetime | None,
    updated_at: datetime,
    is_archived: bool = False,
    deleted: bool = False,
) -> uuid.UUID:
    t = await f.make_task(
        db, workspace_id=ws, created_by=admin, team_id=team, project_id=None
    )
    t.status = status
    t.terminal_since = terminal_since  # type: ignore[assignment]
    t.is_archived = is_archived
    if deleted:
        t.deleted_at = updated_at  # type: ignore[assignment]
    # updated_at setado a mao vence o onupdate do ORM.
    t.updated_at = updated_at  # type: ignore[assignment]
    await db.flush()
    return t.id


async def _escolhidas(db, ctx) -> set[uuid.UUID]:
    with acting_as(**ctx):
        return {
            t.id
            for t in await TaskRepository(db).list_stale_terminal(
                now=NOW, days=DAYS
            )
        }


async def test_so_terminal_velha_viva_e_nao_arquivada_e_escolhida(db) -> None:
    ws, team, admin, ctx = await _mundo(db)

    def plantar(status, since, **kw):
        return _plantar(
            db, ws=ws, admin=admin, team=team, status=status,
            terminal_since=since, updated_at=kw.pop("updated_at", _ago(99)),
            **kw,
        )

    concluida = await plantar(TaskStatus.COMPLETED, _ago(30))
    cancelada = await plantar(TaskStatus.CANCELLED, _ago(30))
    um_segundo_antes = await plantar(
        TaskStatus.COMPLETED, CUTOFF - timedelta(seconds=1)
    )
    # Fora: recente, exatamente no limite, sem relogio.
    await plantar(TaskStatus.COMPLETED, _ago(2))
    await plantar(TaskStatus.CANCELLED, _ago(2))
    await plantar(TaskStatus.COMPLETED, CUTOFF)
    await plantar(TaskStatus.COMPLETED, None)
    # Fora: status vivo mesmo com o relogio correndo.
    await plantar(TaskStatus.IN_PROGRESS, _ago(99))
    await plantar(TaskStatus.EXTERNAL_APPROVAL, _ago(99))
    # Fora: ja arquivada, apagada.
    await plantar(TaskStatus.COMPLETED, _ago(99), is_archived=True)
    await plantar(TaskStatus.COMPLETED, _ago(99), deleted=True)

    assert await _escolhidas(db, ctx) == {concluida, cancelada, um_segundo_antes}


async def test_editar_uma_CANCELADA_nao_adia_o_arquivamento(db) -> None:
    """O relogio e `terminal_since`, nao `updated_at`: editar a tarefa
    cancelada ontem nao a tira da varredura."""
    ws, team, admin, ctx = await _mundo(db)
    alvo = await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.CANCELLED,
        terminal_since=_ago(60), updated_at=_ago(60),
    )
    obj = await db.get(Task, alvo)
    assert obj is not None
    obj.updated_at = _ago(1)  # type: ignore[assignment]
    await db.flush()

    assert await _escolhidas(db, ctx) == {alvo}
