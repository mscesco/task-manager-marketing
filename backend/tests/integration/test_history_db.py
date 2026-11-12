"""task_history e imutavel: UPDATE e DELETE sao recusados pelo banco."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _admin_proj(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    # ADMIN de organizacao: sem vinculo de time.
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    ctx = dict(
        workspace_id=ws, user_id=user, team_tree=(node(team),), org_role="ADMIN"
    )
    return ctx, proj, team


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

