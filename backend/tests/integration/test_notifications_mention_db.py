"""Emissao de TASK_MENTIONED via o emitter (Spec 019, B1).

Cobre: emitir cria TASK_MENTIONED com payload pros mencionados; dedup; o autor
mencionado e excluido (auto-mencao nao notifica).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=r)
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=r, project_id=proj,
        title="Brief",
    )
    ctx = dict(
        workspace_id=ws, user_id=manager,
        memberships=(mship(r, "MANAGER"),), team_tree=(node(r),),
    )
    return ws, r, manager, task, ctx


async def _mention_notifs(db, recipient_id):
    return (
        await db.execute(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.type == "TASK_MENTIONED",
            )
        )
    ).scalars().all()


async def test_mentioned_emite_para_mencionados(db) -> None:
    ws, r, manager, task, ctx = await _world(db)
    u1 = await f.make_user(db, workspace_id=ws)
    u2 = await f.make_user(db, workspace_id=ws)
    with acting_as(**ctx):
        await NotificationEmitter(db).mentioned(
            recipient_ids=[u1, u2], actor_id=manager,
            task_id=task.id, task_title=task.title, comment_id=uuid.uuid4(),
        )
        await db.flush()
        n1 = await _mention_notifs(db, u1)
        assert len(n1) == 1
        assert len(await _mention_notifs(db, u2)) == 1
        assert n1[0].actor_id == manager
        assert n1[0].payload["task_title"] == "Brief"


async def test_mentioned_dedup_e_exclui_autor(db) -> None:
    ws, r, manager, task, ctx = await _world(db)
    u1 = await f.make_user(db, workspace_id=ws)
    with acting_as(**ctx):
        await NotificationEmitter(db).mentioned(
            recipient_ids=[u1, u1, manager],  # duplicado + o proprio autor
            actor_id=manager, task_id=task.id, task_title=task.title,
            comment_id=uuid.uuid4(),
        )
        await db.flush()
        assert len(await _mention_notifs(db, u1)) == 1       # dedup -> 1
        assert len(await _mention_notifs(db, manager)) == 0  # auto-mencao -> 0
