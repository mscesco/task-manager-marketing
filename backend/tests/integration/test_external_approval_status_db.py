"""EXTERNAL_APPROVAL se comporta como tarefa aberta: persiste pela rota e o
aviso de prazo dispara. (Arquivamento: `test_list_stale_terminal_db`.)

NOW fixo 12:00 UTC = 09:00 America/Sao_Paulo -> "hoje" local = 2026-06-25.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TeamNode, TenantContext, set_tenant
from app.db.models import Notification, Task
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
OVERDUE = date(2026, 6, 24)  # ontem -> overdue

_World = tuple[uuid.UUID, uuid.UUID, uuid.UUID, TenantContext]


def _client(db: AsyncSession, ctx: TenantContext) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator[AsyncSession]:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _world(db: AsyncSession) -> _World:
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER"
    )
    forest = (
        TeamNode(team_id=r, parent_team_id=None),
        TeamNode(team_id=a, parent_team_id=r),
    )
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, ctx


async def _reload(db: AsyncSession, task_id: uuid.UUID) -> Task:
    obj = await db.get(Task, task_id)
    assert obj is not None
    await db.refresh(obj)
    return obj


async def test_patch_para_external_approval_persiste(db: AsyncSession) -> None:
    ws, r, a, ctx = await _world(db)
    manager = ctx.user_id
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=None
    )
    await db.commit()

    async with _client(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/tasks/{task.id}",
            json={"status": "EXTERNAL_APPROVAL"},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "EXTERNAL_APPROVAL"

    db_task = await _reload(db, task.id)
    assert db_task.status == TaskStatus.EXTERNAL_APPROVAL


async def test_prazo_dispara_para_external_approval(db: AsyncSession) -> None:
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    t = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=team, title="externa",
        status=TaskStatus.EXTERNAL_APPROVAL,
    )
    t.due_date = OVERDUE
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 1

    n = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.recipient_id == user,
            Notification.type == "TASK_OVERDUE",
            Notification.task_id == t.id,
        )
    )
    assert n.scalar_one() == 1
