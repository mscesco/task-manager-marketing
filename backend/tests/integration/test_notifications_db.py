"""Notification repository no banco (Spec 018, F1).

Cobre: create + list (total/itens), count_unread, mark_read (matched e
not-found), mark_all_read, scoping por recipient (so vejo as minhas) e
ordenacao (mais nova primeiro). Sem service ainda -- testa o repo direto.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models import Notification
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """WS com raiz R, recipient `me` e um segundo usuario `other`."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    me = await f.make_user(db, workspace_id=ws)
    other = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=r, role="OPERATOR")
    await f.add_member(db, workspace_id=ws, user_id=other, team_id=r, role="OPERATOR")
    ctx = dict(
        workspace_id=ws,
        user_id=me,
        memberships=(mship(r, "OPERATOR"),),
        team_tree=(node(r),),
    )
    return ws, r, me, other, ctx


async def test_create_e_lista(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        repo.create(recipient_id=me, actor_id=other, type="TASK_ASSIGNED")
        repo.create(recipient_id=me, actor_id=other, type="TASK_COMMENTED")
        await db.flush()
        page = await repo.list_for_me(params=PageParams(page=1, size=10))
    assert page.total == 2
    assert len(page.items) == 2


async def test_count_unread_e_mark_read(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        n1 = repo.create(recipient_id=me, actor_id=other, type="TASK_ASSIGNED")
        repo.create(recipient_id=me, actor_id=other, type="TASK_COMMENTED")
        await db.flush()
        assert await repo.count_unread() == 2
        assert await repo.mark_read(n1.id) is True
        await db.flush()
        assert await repo.count_unread() == 1
        # idempotente: remarcar a mesma continua True, sem virar 0 de novo
        assert await repo.mark_read(n1.id) is True
        assert await repo.count_unread() == 1


async def test_mark_read_inexistente_retorna_false(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        assert await repo.mark_read(uuid.uuid4()) is False


async def test_mark_all_read(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        for _ in range(3):
            repo.create(recipient_id=me, actor_id=other, type="TASK_ASSIGNED")
        await db.flush()
        marcadas = await repo.mark_all_read()
        await db.flush()
        assert marcadas == 3
        assert await repo.count_unread() == 0


async def test_scoping_so_ve_as_minhas(db) -> None:
    """Notificacao cujo recipient e outro usuario NAO aparece pra mim,
    e marcar a do outro retorna False (-> 404 no service)."""
    ws, r, me, other, ctx = await _world(db)
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        repo.create(recipient_id=me, actor_id=other, type="TASK_ASSIGNED")
        repo.create(recipient_id=other, actor_id=me, type="TASK_ASSIGNED")
        await db.flush()
        page = await repo.list_for_me(params=PageParams(page=1, size=10))
        assert page.total == 1
        assert page.items[0].recipient_id == me
        do_outro = (
            await db.execute(
                select(Notification).where(Notification.recipient_id == other)
            )
        ).scalars().all()
        assert await repo.mark_read(do_outro[0].id) is False


async def test_ordem_mais_nova_primeiro(db) -> None:
    """Carimbos distintos -> feed retorna a mais nova primeiro.

    func.now() e constante na transacao, entao os testes carimbam
    created_at distintos em vez de confiar no relogio do banco.

    ⚠️ Desde a Spec 053 (C) a ordem e por `updated_at` (o aviso que juntou uma
    mudanca nova sobe). Aviso recem-nascido tem `updated_at == created_at`, e
    o teste carimba os dois do mesmo jeito.
    """
    ws, r, me, other, ctx = await _world(db)
    base = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    velha = Notification(
        workspace_id=ws, recipient_id=me, actor_id=other,
        type="TASK_ASSIGNED", created_at=base, updated_at=base,
    )
    nova = Notification(
        workspace_id=ws, recipient_id=me, actor_id=other,
        type="TASK_COMMENTED", created_at=base + timedelta(minutes=5),
        updated_at=base + timedelta(minutes=5),
    )
    db.add(velha)
    db.add(nova)
    await db.flush()
    with acting_as(**ctx):
        repo = NotificationRepository(db)
        page = await repo.list_for_me(params=PageParams(page=1, size=10))
    assert page.items[0].id == nova.id
    assert page.items[1].id == velha.id
