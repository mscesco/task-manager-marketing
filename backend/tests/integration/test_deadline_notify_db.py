"""Spec 023 -- varredura de avisos de prazo (due-soon + overdue).

Contra Postgres real. NOW fixo 12:00 UTC = 09:00 America/Sao_Paulo, entao "hoje"
local = 2026-06-25. Cobre os criterios 1-8 da spec + o endpoint trancado.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, date, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.config import settings
from app.core.deps import get_db_session
from app.db.models import Notification, Task
from app.db.models.enums import TaskStatus
from app.main import create_app
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
HOJE = date(2026, 6, 25)
SOON = date(2026, 6, 27)      # hoje + 2 -> due_soon
OVERDUE = date(2026, 6, 24)   # ontem   -> overdue


async def _ws(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    return ws, team, user


async def _task(db, *, ws, team, user, due, title="t"):
    t = await f.make_task(db, workspace_id=ws, created_by=user, team_id=team, title=title)
    t.due_date = due
    return t


async def _count(db, *, recipient, type_, task_id) -> int:
    r = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.recipient_id == recipient,
            Notification.type == type_,
            Notification.task_id == task_id,
        )
    )
    return r.scalar_one()


# 1 -- due_soon dispara 1x pro responsavel; re-run nao duplica.
async def test_due_soon_dispara_uma_vez(db) -> None:
    ws, team, user = await _ws(db)
    resp = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=resp, team_id=team, role="OPERATOR")
    t = await _task(db, ws=ws, team=team, user=user, due=SOON)
    await f.make_assignment(db, workspace_id=ws, task_id=t.id, user_id=resp, assigned_by=user)
    await db.flush()

    r1 = await DeadlineNotifyService(db).run(now=NOW)
    assert r1["due_soon_count"] == 1
    assert await _count(db, recipient=resp, type_="TASK_DUE_SOON", task_id=t.id) == 1

    # re-run: coluna gravada -> nao redispara
    r2 = await DeadlineNotifyService(db).run(now=NOW)
    assert r2["due_soon_count"] == 0
    assert await _count(db, recipient=resp, type_="TASK_DUE_SOON", task_id=t.id) == 1


# 2 -- overdue dispara 1x; re-run nao duplica.
async def test_overdue_dispara_uma_vez(db) -> None:
    ws, team, user = await _ws(db)
    t = await _task(db, ws=ws, team=team, user=user, due=OVERDUE)
    await db.flush()

    r1 = await DeadlineNotifyService(db).run(now=NOW)
    assert r1["overdue_count"] == 1
    assert await _count(db, recipient=user, type_="TASK_OVERDUE", task_id=t.id) == 1

    r2 = await DeadlineNotifyService(db).run(now=NOW)
    assert r2["overdue_count"] == 0


# 3 -- mudar o due_date reabilita o aviso.
async def test_mudar_prazo_reabilita(db) -> None:
    ws, team, user = await _ws(db)
    t = await _task(db, ws=ws, team=team, user=user, due=SOON)
    await db.flush()

    await DeadlineNotifyService(db).run(now=NOW)
    assert await _count(db, recipient=user, type_="TASK_DUE_SOON", task_id=t.id) == 1

    # move o prazo pra outro dia dentro da janela -> coluna difere -> reavisa
    await db.refresh(t)
    t.due_date = HOJE  # ainda em [hoje, hoje+2]
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["due_soon_count"] == 1
    assert await _count(db, recipient=user, type_="TASK_DUE_SOON", task_id=t.id) == 2


# 4 -- task terminal/bloqueada/arquivada/deletada nunca notifica.
async def test_terminal_arquivada_deletada_nao_notifica(db) -> None:
    ws, team, user = await _ws(db)
    concluida = await _task(db, ws=ws, team=team, user=user, due=OVERDUE, title="c")
    concluida.status = TaskStatus.COMPLETED
    cancelada = await _task(db, ws=ws, team=team, user=user, due=OVERDUE, title="x")
    cancelada.status = TaskStatus.CANCELLED
    bloqueada = await _task(db, ws=ws, team=team, user=user, due=OVERDUE, title="b")
    bloqueada.status = TaskStatus.BLOCKED
    arquivada = await _task(db, ws=ws, team=team, user=user, due=OVERDUE, title="a")
    arquivada.is_archived = True
    deletada = await _task(db, ws=ws, team=team, user=user, due=OVERDUE, title="d")
    deletada.deleted_at = NOW
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 0
    assert r["due_soon_count"] == 0


# 5 -- sem responsavel -> fallback pro criador.
async def test_sem_responsavel_notifica_criador(db) -> None:
    ws, team, user = await _ws(db)
    t = await _task(db, ws=ws, team=team, user=user, due=OVERDUE)
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 1
    assert await _count(db, recipient=user, type_="TASK_OVERDUE", task_id=t.id) == 1


# 6 -- dois workspaces: cada um dispara o seu, isolado.
async def test_dois_workspaces_isolados(db) -> None:
    ws1, team1, u1 = await _ws(db)
    ws2, team2, u2 = await _ws(db)
    t1 = await _task(db, ws=ws1, team=team1, user=u1, due=OVERDUE, title="w1")
    t2 = await _task(db, ws=ws2, team=team2, user=u2, due=SOON, title="w2")
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 1
    assert r["due_soon_count"] == 1
    assert await _count(db, recipient=u1, type_="TASK_OVERDUE", task_id=t1.id) == 1
    assert await _count(db, recipient=u2, type_="TASK_DUE_SOON", task_id=t2.id) == 1


# 8 -- dedup: task ja marcada (backfill) pro prazo atual nao dispara.
async def test_backfill_nao_dispara_retroativo(db) -> None:
    ws, team, user = await _ws(db)
    t = await _task(db, ws=ws, team=team, user=user, due=OVERDUE)
    # simula o backfill da migration: colunas = due_date
    t.due_soon_notified_for = OVERDUE
    t.overdue_notified_for = OVERDUE
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 0
    assert r["due_soon_count"] == 0


# 7 -- endpoint trancado: sem token / token errado -> 401; token certo -> 200.
def _client(db) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    app.dependency_overrides[get_db_session] = _session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_endpoint_trancado(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    async with _client(db) as client:
        r_sem = await client.post("/api/v1/system/tasks/notify-deadlines")
        assert r_sem.status_code == 401
        r_errado = await client.post(
            "/api/v1/system/tasks/notify-deadlines",
            headers={"X-System-Token": "errado"},
        )
        assert r_errado.status_code == 401
        r_ok = await client.post(
            "/api/v1/system/tasks/notify-deadlines",
            headers={"X-System-Token": "tok-correto-123"},
        )
        assert r_ok.status_code == 200
