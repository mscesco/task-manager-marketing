"""API de leitura de notificacoes (Spec 018, F4) -- nivel HTTP.

Via httpx ASGITransport com sessao/UoW/auth do teste. Cobre: feed so com
as minhas, unread-count, mark-read (flipa read_at), mark-read de outro =
404, unread_only filtra, paginacao, read-all.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TeamNode, TenantContext, set_tenant
from app.db.models import Notification
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f

pytestmark = pytest.mark.integration


def _client(db, ctx: TenantContext) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
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


async def _world(db):
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    me = await f.make_user(db, workspace_id=ws)
    other = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=r, role="OPERATOR")
    await f.add_member(db, workspace_id=ws, user_id=other, team_id=r, role="OPERATOR")
    ctx = TenantContext(
        workspace_id=ws,
        user_id=me,
        roles=frozenset({"OPERATOR"}),
        permissions=permissions_for_roles(frozenset({"OPERATOR"})),
        memberships=(Membership(team_id=r, role="OPERATOR"),),
        team_tree=(TeamNode(team_id=r, parent_team_id=None),),
    )
    return ws, r, me, other, ctx


def _notif(ws, recipient, *, read=False, created_at=None) -> Notification:
    n = Notification(
        workspace_id=ws,
        recipient_id=recipient,
        actor_id=None,
        type="TASK_ASSIGNED",
        read_at=datetime.now(timezone.utc) if read else None,
    )
    if created_at is not None:
        n.created_at = created_at
    return n


async def test_feed_so_as_minhas(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    db.add(_notif(ws, me))
    db.add(_notif(ws, other))
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/notifications")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1


async def test_unread_count(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    db.add(_notif(ws, me))
    db.add(_notif(ws, me))
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/notifications/unread-count")
    assert resp.status_code == 200
    assert resp.json()["count"] == 2


async def test_mark_read_flipa_e_baixa_contagem(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    n = _notif(ws, me)
    db.add(n)
    await db.flush()
    nid = n.id
    await db.commit()
    async with _client(db, ctx) as c:
        r1 = await c.post(f"/api/v1/notifications/{nid}/read")
        r2 = await c.get("/api/v1/notifications/unread-count")
    assert r1.status_code == 204
    assert r2.json()["count"] == 0


async def test_mark_read_de_outro_404(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    n = _notif(ws, other)  # do OUTRO usuario
    db.add(n)
    await db.flush()
    nid = n.id
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(f"/api/v1/notifications/{nid}/read")
    assert resp.status_code == 404


async def test_unread_only_filtra(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    db.add(_notif(ws, me, read=True))
    db.add(_notif(ws, me, read=False))
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/notifications", params={"unread_only": "true"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_read_all(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    for _ in range(3):
        db.add(_notif(ws, me))
    await db.commit()
    async with _client(db, ctx) as c:
        r1 = await c.post("/api/v1/notifications/read-all")
        r2 = await c.get("/api/v1/notifications/unread-count")
    assert r1.status_code == 200
    assert r1.json()["updated"] == 3
    assert r2.json()["count"] == 0


async def test_paginacao(db) -> None:
    ws, r, me, other, ctx = await _world(db)
    base = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    for i in range(3):
        db.add(_notif(ws, me, created_at=base + timedelta(minutes=i)))
    await db.commit()
    async with _client(db, ctx) as c:
        p1 = (await c.get("/api/v1/notifications", params={"page": 1, "size": 2})).json()
        p2 = (await c.get("/api/v1/notifications", params={"page": 2, "size": 2})).json()
    assert p1["total"] == 3 and len(p1["items"]) == 2
    assert p2["total"] == 3 and len(p2["items"]) == 1
