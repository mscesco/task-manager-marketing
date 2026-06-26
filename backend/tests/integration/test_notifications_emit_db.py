"""Emissao de TASK_ASSIGNED via add_assignee (Spec 018, F2).

Cobre: designar emite 1 notificacao pro destinatario com payload correto;
auto-designacao emite 0; re-designar (idempotente) nao duplica.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.tasks.application.collaboration_service import CollaborationService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """WS com raiz R + subtime A; manager de R; projeto comum no time A."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (node(r), node(a, r))
    mgr_ctx = dict(
        workspace_id=ws,
        user_id=manager,
        memberships=(mship(r, "MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, manager, proj, mgr_ctx


async def _notifs_de(db, recipient_id):
    return (
        await db.execute(
            select(Notification).where(Notification.recipient_id == recipient_id)
        )
    ).scalars().all()


async def test_designar_emite_notificacao(db) -> None:
    ws, r, a, manager, proj, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj,
        title="Revisar landing",
    )
    with acting_as(**mgr_ctx):
        _, created = await CollaborationService(db).add_assignee(
            task_id=task.id, user_id=alvo
        )
        await db.flush()
        rows = await _notifs_de(db, alvo)

    assert created is True
    assert len(rows) == 1
    n = rows[0]
    assert n.type == "TASK_ASSIGNED"
    assert n.actor_id == manager
    assert n.task_id == task.id
    assert n.read_at is None
    assert n.payload["task_title"] == "Revisar landing"
    assert n.payload["actor_name"]  # nome do manager (snapshot) preenchido


async def test_auto_designacao_nao_emite(db) -> None:
    ws, r, a, manager, proj, mgr_ctx = await _world(db)
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj
    )
    with acting_as(**mgr_ctx):
        # manager (MANAGER da raiz) alcanca a task e designa a si mesmo
        _, created = await CollaborationService(db).add_assignee(
            task_id=task.id, user_id=manager
        )
        await db.flush()
        rows = await _notifs_de(db, manager)

    assert created is True  # o assignment acontece
    assert len(rows) == 0   # mas nao notifica a si mesmo


async def test_redesignar_idempotente_nao_duplica(db) -> None:
    ws, r, a, manager, proj, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj
    )
    with acting_as(**mgr_ctx):
        svc = CollaborationService(db)
        _, c1 = await svc.add_assignee(task_id=task.id, user_id=alvo)
        await db.flush()
        _, c2 = await svc.add_assignee(task_id=task.id, user_id=alvo)  # no-op
        await db.flush()
        rows = await _notifs_de(db, alvo)

    assert c1 is True and c2 is False
    assert len(rows) == 1  # so a primeira designacao emitiu
