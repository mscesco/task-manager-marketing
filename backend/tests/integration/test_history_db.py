"""task_history: escrita por evento + imutabilidade + 1 trigger (ADR 0015)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _admin_proj(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    ctx = dict(
        workspace_id=ws, user_id=user, memberships=(mship(team, "ADMIN"),), team_tree=(node(team),)
    )
    return ctx, proj, team


async def test_eventos_create_e_status(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        task = await svc.create(CreateTaskCommand(
            title="t",
            project_id=proj,
            team_id=team,
            assignee_ids=[ctx["user_id"]]),
        )
        await svc.update(task_id=task.id, command=UpdateTaskCommand(status=TaskStatus.IN_PROGRESS))
    tipos = (
        (
            await db.execute(
                text("SELECT event_type FROM task_history WHERE task_id=:i ORDER BY created_at"),
                {"i": task.id},
            )
        )
        .scalars()
        .all()
    )
    assert "created" in tipos
    assert "status_changed" in tipos


async def test_update_em_task_history_bloqueado(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(
                title="t",
                project_id=proj,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
    with pytest.raises(DBAPIError):
        await db.execute(
            text("UPDATE task_history SET event_type='x' WHERE task_id=:i"), {"i": task.id}
        )
        await db.flush()


async def test_delete_em_task_history_bloqueado(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(
                title="t",
                project_id=proj,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
    with pytest.raises(DBAPIError):
        await db.execute(text("DELETE FROM task_history WHERE task_id=:i"), {"i": task.id})
        await db.flush()


async def test_exatamente_uma_trigger_de_imutabilidade(db) -> None:
    """Apos upgrade head (com 0005): 1 trigger BEFORE UPDATE/DELETE em task_history."""
    rows = (
        (
            await db.execute(
                text(
                    "SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid "
                    "WHERE c.relname='task_history' AND NOT t.tgisinternal"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1, f"esperava 1 trigger, achei {rows}"
