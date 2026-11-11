"""Os dois jobs diarios (o n8n chama) pulam a linha que outro ja travou.

`FOR UPDATE SKIP LOCKED` (auditoria de 16/10) impede que um POST repetido --
o n8n tenta de novo quando a resposta demora -- avise o prazo duas vezes ou
grave o arquivamento em dobro. A auditoria de 11/11 (item 16) achou a trava
sem teste: apagar a linha deixava a suite verde.

A corrida em si precisa de duas conexoes com dados confirmados, o que este
arquivo nao monta; o que ele prende e que a leitura de cada job sai travada.
SABOTAGEM: tirar o `with_for_update(skip_locked=True...)` de
`deadline_notify_service._run_kind` ou de `task_repository.list_stale_terminal`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    return ws, team, admin


async def _sql_do_job(connection, job) -> list[str]:
    sqls: list[str] = []

    def _anota(conn, cursor, statement, *args) -> None:
        sqls.append(" ".join(statement.split()).upper())

    event.listen(connection.sync_connection, "before_cursor_execute", _anota)
    try:
        await job()
    finally:
        event.remove(connection.sync_connection, "before_cursor_execute", _anota)
    return sqls


async def test_aviso_de_prazo_le_as_tarefas_com_skip_locked(db, connection) -> None:
    ws, team, admin = await _mundo(db)
    t = await f.make_task(
        db, workspace_id=ws, created_by=admin, team_id=team, title="vencida",
        status=TaskStatus.IN_PROGRESS,
    )
    t.due_date = date(2026, 6, 24)
    await db.flush()

    sqls = await _sql_do_job(connection, lambda: DeadlineNotifyService(db).run(now=NOW))
    assert any("FOR UPDATE" in q and "SKIP LOCKED" in q for q in sqls)


async def test_arquivamento_le_as_tarefas_com_skip_locked(db, connection) -> None:
    ws, team, admin = await _mundo(db)
    t = await f.make_task(db, workspace_id=ws, created_by=admin, team_id=team, title="x")
    velho = NOW - timedelta(days=30)
    t.status = TaskStatus.COMPLETED
    t.completed_at = t.updated_at = t.terminal_since = velho
    await db.flush()

    sqls = await _sql_do_job(connection, lambda: StaleArchivalService(db).run(now=NOW))
    assert any("FOR UPDATE" in q and "SKIP LOCKED" in q for q in sqls)
