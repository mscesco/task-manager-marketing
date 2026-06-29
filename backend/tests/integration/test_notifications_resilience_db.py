"""Blindagem do emitter (Spec 018): falha na emissao NAO derruba a acao.

Reproduz o incidente de producao -- o INSERT da notificacao falha (aqui via
FK violada, igual a 'tabela ausente' abortar a transacao) -- e prova que o
assignment e o comentario SOBREVIVEM. A emissao roda num savepoint: a falha
e contida (rollback so do savepoint) + logada, nunca propagada.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.tenant import require_tenant
from app.db.models import Comment, Notification, TaskAssignment
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)
from app.modules.tasks.application.collaboration_service import CollaborationService
from app.modules.tasks.application.comment_service import CommentService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


def _create_quebrado(self, **kwargs):
    """Troca o create do repo por um INSERT que FALHA no flush: recipient
    inexistente -> viola a FK -> reproduz o abort de transacao do incidente
    de producao. (self = instancia do NotificationRepository.)"""
    bad = Notification(
        workspace_id=require_tenant().workspace_id,
        recipient_id=uuid.uuid4(),  # nao existe em users -> FK falha no flush
        actor_id=None,
        type="TASK_ASSIGNED",
    )
    self.session.add(bad)
    return bad


async def _world(db):
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    forest = (node(r), node(a, r))
    mgr_ctx = dict(
        workspace_id=ws, user_id=manager,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    )
    return ws, r, a, manager, alvo, proj, mgr_ctx


async def test_emissao_quebrada_nao_derruba_designar(db, monkeypatch) -> None:
    ws, r, a, manager, alvo, proj, mgr_ctx = await _world(db)
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj
    )
    monkeypatch.setattr(NotificationRepository, "create", _create_quebrado)
    with acting_as(**mgr_ctx):
        # NAO deve levantar, mesmo com o INSERT da notificacao falhando.
        _, created = await CollaborationService(db).add_assignee(
            task_id=task.id, user_id=alvo
        )
        await db.flush()
        assignments = (
            await db.execute(
                select(TaskAssignment).where(
                    TaskAssignment.task_id == task.id,
                    TaskAssignment.user_id == alvo,
                )
            )
        ).scalars().all()
        notifs = (await db.execute(select(Notification))).scalars().all()

    assert created is True        # o assignment aconteceu
    assert len(assignments) == 1  # ... e SOBREVIVEU a falha de emissao
    assert len(notifs) == 0       # a notificacao quebrada foi revertida (savepoint)


async def test_emissao_quebrada_nao_derruba_comentario(db, monkeypatch) -> None:
    ws, r, a, manager, alvo, proj, mgr_ctx = await _world(db)
    task = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=alvo, assigned_by=manager
    )
    monkeypatch.setattr(NotificationRepository, "create", _create_quebrado)
    with acting_as(**mgr_ctx):
        dto = await CommentService(db).create_comment(
            task_id=task.id, content="comentario apesar da falha"
        )
        await db.flush()
        comments = (
            await db.execute(select(Comment).where(Comment.task_id == task.id))
        ).scalars().all()
        notifs = (await db.execute(select(Notification))).scalars().all()

    assert dto.id is not None   # o comentario foi criado
    assert len(comments) == 1   # ... e SOBREVIVEU a falha de emissao
    assert len(notifs) == 0     # notificacao quebrada revertida
