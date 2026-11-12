"""Varredura multi-workspace + endpoint trancado.

Cobre, contra Postgres real:
  - StaleArchivalService.run: arquiva por workspace, atribui ao admin de CADA
    um, pula workspace sem admin.
  - O endpoint POST /system/tasks/archive-stale: token certo -> 200; token
    errado -> 401 (token ausente: `tests/test_system_auth.py`).
  - Workspace que falha: volta so o dele, os outros seguem.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.tenant import require_tenant
from app.db.models import TaskHistory
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from app.modules.tasks.application.task_service import TaskService
from tests.integration import factories as f
from tests.integration.conftest import cliente

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
VELHO = NOW - timedelta(days=30)


async def _ws_with_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    return ws, team, admin


async def _stale_completed(db, *, ws, team, user, title="x"):
    """Tarefa concluida ha muito tempo, plantada direto (sem service).

    ⚠️ `terminal_since` junto com `completed_at`: e ele que a varredura le;
    sem a linha, estes testes acusam "arquivou 0" com o produto correto.
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
    # Vincula como OPERATOR, sem org_role: ninguem e ADMIN de organizacao.
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="OPERATOR")
    t = await _stale_completed(db, ws=ws, team=team, user=user)
    await db.flush()

    result = await StaleArchivalService(db).run(now=NOW)

    assert result["by_workspace"][str(ws)] == {"archived": 0, "skipped": "no_admin"}
    await db.refresh(t)
    assert t.is_archived is False


async def test_workspace_que_falha_volta_so_o_dele(db, monkeypatch) -> None:
    """O do meio arquiva e estoura: o rollback desfaz so ele, o commit do
    anterior sobrevive e o seguinte ainda roda."""
    ws1, team1, admin1 = await _ws_with_admin(db)
    ws2, team2, admin2 = await _ws_with_admin(db)
    ws3, team3, admin3 = await _ws_with_admin(db)
    t1 = await _stale_completed(db, ws=ws1, team=team1, user=admin1, title="a")
    t2 = await _stale_completed(db, ws=ws2, team=team2, user=admin2, title="b")
    t3 = await _stale_completed(db, ws=ws3, team=team3, user=admin3, title="c")
    # ⚠️ Sem o commit, o rollback do workspace que falha levaria a montagem junto.
    await db.commit()

    original = TaskService.archive_stale

    async def _estoura_no_ws2(self, **kwargs):
        count = await original(self, **kwargs)
        if require_tenant().workspace_id == ws2:
            raise RuntimeError("falha no meio")
        return count

    monkeypatch.setattr(TaskService, "archive_stale", _estoura_no_ws2)

    result = await StaleArchivalService(db).run(now=NOW)

    assert result["by_workspace"][str(ws2)] == {"archived": 0, "error": True}
    assert result["by_workspace"][str(ws1)] == {"archived": 1}
    assert result["by_workspace"][str(ws3)] == {"archived": 1}
    assert result["archived_count"] == 2
    for t, arquivada in ((t1, True), (t2, False), (t3, True)):
        await db.refresh(t)
        assert t.is_archived is arquivada


# ---- Endpoint HTTP (trava de token) ----
async def test_endpoint_token_certo_200(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    ws, team, admin = await _ws_with_admin(db)
    await _stale_completed(db, ws=ws, team=team, user=admin)
    await db.flush()

    async with cliente(db) as client:
        r = await client.post(
            "/api/v1/system/tasks/archive-stale",
            headers={"X-System-Token": "tok-correto-123"},
        )
    assert r.status_code == 200
    assert r.json()["archived_count"] == 1


async def test_endpoint_token_errado_401(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "system_api_token", "tok-correto-123")
    async with cliente(db) as client:
        r = await client.post(
            "/api/v1/system/tasks/archive-stale",
            headers={"X-System-Token": "errado"},
        )
    assert r.status_code == 401
