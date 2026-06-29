"""Comentario notifica tambem o CRIADOR da task (Spec 018, Slice 2).

Audiencia do TASK_COMMENTED = responsaveis + criador da task, menos o autor
do comentario, deduplicado. Cobre: criador e notificado; criador que tambem
e responsavel nao duplica; criador que comenta na propria task nao recebe.
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
    comentador = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=comentador, team_id=r, role="MANAGER"
    )
    criador = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=criador, team_id=a, role="OPERATOR"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=comentador, team_id=a
    )
    task = await f.make_task(
        db, workspace_id=ws, created_by=criador, team_id=a, project_id=proj,
        title="Post do dia",
    )
    forest = (node(r), node(a, r))
    comentador_ctx = dict(
        workspace_id=ws, user_id=comentador,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    )
    criador_ctx = dict(
        workspace_id=ws, user_id=criador,
        memberships=(mship(a, "OPERATOR"),), team_tree=forest,
    )
    return ws, r, a, comentador, criador, proj, task, comentador_ctx, criador_ctx


async def _comment_notifs(db, recipient_id):
    return (
        await db.execute(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.type == "TASK_COMMENTED",
            )
        )
    ).scalars().all()


async def test_criador_e_notificado(db) -> None:
    ws, r, a, comentador, criador, proj, task, comentador_ctx, _ = await _world(db)
    with acting_as(**comentador_ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content="comentei na sua task"
        )
        await db.flush()
        do_criador = await _comment_notifs(db, criador)
        do_comentador = await _comment_notifs(db, comentador)

    assert len(do_criador) == 1  # criador da task recebe, mesmo sem ser responsavel
    assert do_criador[0].actor_id == comentador
    assert len(do_comentador) == 0  # o autor nao se notifica


async def test_criador_que_e_responsavel_nao_duplica(db) -> None:
    ws, r, a, comentador, criador, proj, task, comentador_ctx, _ = await _world(db)
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=criador, assigned_by=comentador
    )
    with acting_as(**comentador_ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content="comentario"
        )
        await db.flush()
        do_criador = await _comment_notifs(db, criador)

    assert len(do_criador) == 1  # criador + responsavel = UMA (dedup)


async def test_criador_que_comenta_na_propria_nao_recebe(db) -> None:
    ws, r, a, comentador, criador, proj, task, _, criador_ctx = await _world(db)
    with acting_as(**criador_ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content="comentei na minha propria task"
        )
        await db.flush()
        do_criador = await _comment_notifs(db, criador)

    assert len(do_criador) == 0  # autor da task comenta -> nao se notifica


async def test_criador_e_responsavel_distinto_ambos_recebem(db) -> None:
    """Sanidade: criador e um responsavel DIFERENTE -> dois destinatarios."""
    ws, r, a, comentador, criador, proj, task, comentador_ctx, _ = await _world(db)
    resp = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=resp, team_id=a, role="OPERATOR")
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=resp, assigned_by=comentador
    )
    with acting_as(**comentador_ctx):
        await CommentService(db).create_comment(task_id=task.id, content="oi")
        await db.flush()
        assert len(await _comment_notifs(db, criador)) == 1
        assert len(await _comment_notifs(db, resp)) == 1


