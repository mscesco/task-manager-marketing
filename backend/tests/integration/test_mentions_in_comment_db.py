"""@menções fiadas no create_comment (Spec 019, B2).

Cobre: mencao notifica (TASK_MENTIONED) e SUPRIME o TASK_COMMENTED pra mesma
pessoa (D3); auto-mencao nao emite; id invalido e descartado sem quebrar o
comentario; mencionado nao-responsavel recebe so a mencao.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.tasks.application.comment_service import CommentService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """WS raiz; comentador MANAGER que tambem e o criador da task."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    comentador = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=comentador, team_id=r, role="MANAGER"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=comentador, team_id=r
    )
    task = await f.make_task(
        db, workspace_id=ws, created_by=comentador, team_id=r, project_id=proj,
        title="Brief",
    )
    ctx = dict(
        workspace_id=ws, user_id=comentador,
        memberships=(mship(r, "MANAGER"),), team_tree=(node(r),),
    )
    return ws, r, comentador, task, ctx


async def _by_type(db, recipient_id, tipo):
    return (
        await db.execute(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.type == tipo,
            )
        )
    ).scalars().all()


async def test_mencao_notifica_e_suprime_comentario(db) -> None:
    ws, r, comentador, task, ctx = await _world(db)
    mencionado = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=mencionado, team_id=r, role="OPERATOR"
    )
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=outro, team_id=r, role="OPERATOR"
    )
    # ambos responsaveis pela task
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=mencionado,
        assigned_by=comentador,
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=outro,
        assigned_by=comentador,
    )
    with acting_as(**ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content=f"valeu @[Fulano]({mencionado})!"
        )
        await db.flush()
        # mencionado: 1 mencao, 0 comentario (suprimido apesar de ser responsavel)
        assert len(await _by_type(db, mencionado, "TASK_MENTIONED")) == 1
        assert len(await _by_type(db, mencionado, "TASK_COMMENTED")) == 0
        # outro responsavel (nao mencionado): 0 mencao, 1 comentario
        assert len(await _by_type(db, outro, "TASK_MENTIONED")) == 0
        assert len(await _by_type(db, outro, "TASK_COMMENTED")) == 1


async def test_self_mencao_nao_emite(db) -> None:
    ws, r, comentador, task, ctx = await _world(db)
    with acting_as(**ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content=f"me marcando @[Eu]({comentador})"
        )
        await db.flush()
        assert len(await _by_type(db, comentador, "TASK_MENTIONED")) == 0


async def test_mencao_id_invalido_descartado(db) -> None:
    ws, r, comentador, task, ctx = await _world(db)
    resp = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=resp, team_id=r, role="OPERATOR"
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=resp, assigned_by=comentador
    )
    fantasma = uuid.uuid4()  # nao existe como usuario
    with acting_as(**ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content=f"oi @[Fantasma]({fantasma})"
        )
        await db.flush()
        # nenhuma mencao no workspace (id invalido descartado antes de emitir)
        mencoes = (
            await db.execute(
                select(Notification).where(
                    Notification.workspace_id == ws,
                    Notification.type == "TASK_MENTIONED",
                )
            )
        ).scalars().all()
        assert len(mencoes) == 0
        # o comentario funcionou e o responsavel foi notificado normalmente
        assert len(await _by_type(db, resp, "TASK_COMMENTED")) == 1


async def test_mencionado_nao_responsavel_recebe_so_mencao(db) -> None:
    ws, r, comentador, task, ctx = await _world(db)
    bystander = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=bystander, team_id=r, role="OPERATOR"
    )
    with acting_as(**ctx):
        await CommentService(db).create_comment(
            task_id=task.id, content=f"@[B]({bystander}) da uma olhada"
        )
        await db.flush()
        assert len(await _by_type(db, bystander, "TASK_MENTIONED")) == 1
        assert len(await _by_type(db, bystander, "TASK_COMMENTED")) == 0
