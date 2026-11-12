"""Ordem do feed de notificacoes no repositorio (o resto e testado pela rota,
em `test_notifications_api_db`)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

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


async def test_ordem_mais_nova_primeiro(db) -> None:
    """Carimbos distintos -> feed retorna a mais nova primeiro.

    func.now() e constante na transacao, entao o teste carimba as datas.
    A ordem e por `updated_at` (o aviso que juntou uma mudanca nova sobe);
    aviso recem-nascido tem `updated_at == created_at`.
    """
    ws, r, me, other, ctx = await _world(db)
    base = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
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
