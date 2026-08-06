"""Varredura multi-workspace + endpoint trancado (Spec 013, Fatia 2).

Cobre, contra Postgres real:
  - StaleArchivalService.run: arquiva por workspace, atribui ao admin de CADA
    um, pula workspace sem admin, idempotencia, isolamento entre workspaces.
  - O endpoint POST /system/tasks/archive-stale: token certo -> 200; token
    errado/ausente -> 401.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import get_db_session
from app.db.models import TaskHistory
from app.db.models.enums import TaskStatus
from app.main import create_app
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
VELHO = NOW - timedelta(days=30)


async def _ws_with_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=team, role="ADMIN")
    return ws, team, admin


async def _stale_completed(db, *, ws, team, user, title="x"):
    """Tarefa concluida ha muito tempo, plantada direto (sem service).

    ⚠️ `terminal_since` junto com `completed_at`, mesma formula do backfill das
    0008/0009. Desde a fatia 2b da Spec 035 e ele que a varredura le; sem a
    linha, estes testes acusam "arquivou 0" com o produto correto.
    """
    t = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=team, title=title
    )
    t.status = TaskStatus.COMPLETED
    t.completed_at = VELHO
    t.updated_at = VELHO
    t.terminal_since = VELHO
    return t


async def test_run_arquiva_por_workspace_atribuindo_ao_admin(db) -> None:
    ws1, team1, admin1 = await _ws_with_admin(db)
    ws2, team2, admin2 = await _ws_with_admin(db)
    t1 = await _stale_completed(db, ws=ws1, team=team1, user=admin1, title="a")
    t2 = await _stale_completed(db, ws=ws2, team=team2, user=admin2, title="b")
    await db.flush()

    result = await StaleArchivalService(db).run(now=NOW)

    assert result["archived_count"] == 2
    await db.refresh(t1)
    await db.refresh(t2)
    assert t1.is_archived is True
    assert t2.is_archived is True

    # Cada history atribuido ao admin do SEU workspace, com flag automated.
    h1 = (
        await db.execute(
            select(TaskHistory).where(
                TaskHistory.task_id == t1.id, TaskHistory.event_type == "archived"
            )
        )
    ).scalars().one()
    assert h1.user_id == admin1
    assert h1.event_metadata == {"automated": True, "reason": "stale_terminal"}


async def test_workspace_sem_admin_e_pulado(db) -> None:
    # Workspace com task elegivel mas SEM admin ativo -> pulado, nao arquiva.
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    # Vincula como OPERATOR, nao ADMIN.
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="OPERATOR")
    t = await _stale_completed(db, ws=ws, team=team, user=user)
    await db.flush()

    result = await StaleArchivalService(db).run(now=NOW)

    assert result["by_workspace"][str(ws)] == {"archived": 0, "skipped": "no_admin"}
    await db.refresh(t)
    assert t.is_archived is False


async def test_idempotente(db) -> None:
    ws, team, admin = await _ws_with_admin(db)
    await _stale_completed(db, ws=ws, team=team, user=admin)
    await db.flush()

    svc = StaleArchivalService(db)
    first = await svc.run(now=NOW)
    second = await svc.run(now=NOW)

    assert first["archived_count"] == 1
    assert second["archived_count"] == 0


# ---- Endpoint HTTP (trava de token) ----
def _client(db) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    app.dependency_overrides[get_db_session] = _session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_endpoint_token_certo_200(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    ws, team, admin = await _ws_with_admin(db)
    await _stale_completed(db, ws=ws, team=team, user=admin)
    await db.flush()

    async with _client(db) as client:
        r = await client.post(
            "/api/v1/system/tasks/archive-stale",
            headers={"X-System-Token": "tok-correto-123"},
        )
    assert r.status_code == 200
    assert r.json()["archived_count"] == 1


async def test_endpoint_token_errado_401(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    async with _client(db) as client:
        r = await client.post(
            "/api/v1/system/tasks/archive-stale",
            headers={"X-System-Token": "errado"},
        )
    assert r.status_code == 401


async def test_endpoint_token_ausente_401(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    async with _client(db) as client:
        r = await client.post("/api/v1/system/tasks/archive-stale")
    assert r.status_code == 401
