"""Emissao de TASK_COMMENTED via create_comment (Spec 018, F3).

Fan-out pros responsaveis da task, menos o autor. Cobre: comentar notifica
os outros responsaveis; autor-responsavel nao recebe; task sem responsavel
emite 0; replica tambem notifica.

Os responsaveis sao montados via factory (make_assignment, insert direto)
para NAO disparar TASK_ASSIGNED e isolar so as notificacoes de comentario.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.tasks.application.comment_service import CommentService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj,
        title="Banner home",
    )
    forest = (node(r), node(a, r))
    mgr_ctx = dict(
        workspace_id=ws, user_id=manager,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    )
    return ws, r, a, manager, proj, task, forest, mgr_ctx


async def _op(db, ws, a):
    """OPERATOR do time A (enxerga a task de A; pode comentar e ser responsavel)."""
    u = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=u, team_id=a, role="OPERATOR")
    return u


def _op_ctx(ws, a, forest, user_id):
    return dict(
        workspace_id=ws, user_id=user_id,
        memberships=(mship(a, "OPERATOR"),), team_tree=forest,
    )


async def _comment_notifs(db, recipient_id):
    return (
        await db.execute(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.type == "TASK_COMMENTED",
            )
        )
    ).scalars().all()


async def test_comentar_notifica_responsaveis(db) -> None:
    ws, r, a, manager, proj, task, forest, mgr_ctx = await _world(db)
    resp1 = await _op(db, ws, a)
    resp2 = await _op(db, ws, a)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=resp1, assigned_by=manager
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=resp2, assigned_by=manager
    )
    autor = await _op(db, ws, a)  # terceiro que ve a task
    with acting_as(**_op_ctx(ws, a, forest, autor)):
        await CommentService(db).create_comment(task_id=task.id, content="olha isso")
        await db.flush()
        n1 = await _comment_notifs(db, resp1)
        n2 = await _comment_notifs(db, resp2)
        na = await _comment_notifs(db, autor)

    assert len(n1) == 1 and len(n2) == 1
    assert len(na) == 0  # autor (nao-responsavel) nao recebe
    assert n1[0].comment_id is not None
    assert n1[0].actor_id == autor
    assert n1[0].payload["task_title"] == "Banner home"


async def test_autor_responsavel_nao_recebe(db) -> None:
    ws, r, a, manager, proj, task, forest, mgr_ctx = await _world(db)
    autor = await _op(db, ws, a)
    outro = await _op(db, ws, a)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=autor, assigned_by=manager
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=outro, assigned_by=manager
    )
    with acting_as(**_op_ctx(ws, a, forest, autor)):
        await CommentService(db).create_comment(
            task_id=task.id, content="comentario do proprio responsavel"
        )
        await db.flush()
        n_autor = await _comment_notifs(db, autor)
        n_outro = await _comment_notifs(db, outro)

    assert len(n_autor) == 0  # autor-responsavel nao se notifica
    assert len(n_outro) == 1  # o outro responsavel recebe


async def test_sem_responsaveis_nao_emite(db) -> None:
    ws, r, a, manager, proj, task, forest, mgr_ctx = await _world(db)
    with acting_as(**mgr_ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content="ninguem responsavel"
        )
        await db.flush()
        todas = (await db.execute(select(Notification))).scalars().all()

    assert len(todas) == 0


async def test_replica_tambem_notifica(db) -> None:
    ws, r, a, manager, proj, task, forest, mgr_ctx = await _world(db)
    resp = await _op(db, ws, a)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=resp, assigned_by=manager
    )
    with acting_as(**mgr_ctx):
        svc = CommentService(db)
        pai = await svc.create_comment(task_id=task.id, content="comentario pai")
        await db.flush()
        await svc.create_comment(
            task_id=task.id, content="resposta", parent_comment_id=pai.id
        )
        await db.flush()
        n = await _comment_notifs(db, resp)

    assert len(n) == 2  # comentario + replica, ambos notificam o responsavel
