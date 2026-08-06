"""Varredura de auto-arquivamento (Spec 013/035) -- contra Postgres real.

Cobre: arquiva so os elegiveis (terminais com `terminal_since` mais velho que
o limite), grava history ARCHIVED com flag automated, e idempotencia.
Isolamento de tenant: a varredura num workspace nao toca no outro.

⚠️ A REGRA MUDOU DE FONTE na fatia 2b da Spec 035. Era `completed_at` para
COMPLETED e `updated_at` para CANCELLED; passou a ser `terminal_since` para as
duas. Ver `_set_terminal` abaixo, e `test_equivalencia_varredura_db.py`, que
prova que o conjunto selecionado continua o mesmo.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db.models import TaskHistory
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import TaskService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)


async def _ws_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ctx, ws, team, user


async def _mk(db, ws, user, team, title):
    """make_task encurtado (mantem as linhas dentro do limite do ruff)."""
    return await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=team, title=title
    )


def _set_terminal(task, *, status, completed_at=None, when):
    """Forca status + carimbos no passado. Atribuir updated_at explicito
    sobrescreve o onupdate ORM (que e ORM-side, nao trigger de banco).

    ⚠️ `terminal_since` usa a MESMA formula do backfill das migrations 0008 e
    0009 (`COALESCE(completed_at, updated_at)` para COMPLETED, `updated_at`
    para CANCELLED). Estes testes plantam linha direto, sem passar pelo
    service, entao nada preencheria o campo -- e desde a fatia 2b da Spec 035 e
    ele que a varredura le. Sem esta linha os seis testes de varredura acusam
    "arquivou 0", que e o produto CERTO agindo sobre um mundo que nao existe
    em producao (la o backfill ja passou).

    ⚠️ Consequencia aceita: este arquivo deixa de provar que o PRODUTO grava o
    relogio -- ele planta o valor. Quem prova a escrita e
    `test_terminal_since_escrita_db.py`, e por isso ele existe separado.
    """
    task.status = status
    task.completed_at = completed_at
    task.updated_at = when
    task.terminal_since = completed_at or when


async def test_varredura_arquiva_so_os_elegiveis(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    velho = NOW - timedelta(days=21)
    recente = NOW - timedelta(days=5)

    t_done_velha = await _mk(db, ws, user, team, "done velha")
    _set_terminal(t_done_velha, status=TaskStatus.COMPLETED, completed_at=velho, when=velho)

    t_done_recente = await _mk(db, ws, user, team, "done recente")
    _set_terminal(t_done_recente, status=TaskStatus.COMPLETED, completed_at=recente, when=recente)

    t_cancel_velha = await _mk(db, ws, user, team, "cancel velha")
    _set_terminal(t_cancel_velha, status=TaskStatus.CANCELLED, when=velho)

    t_ativa = await _mk(db, ws, user, team, "ativa")
    # fica BACKLOG (default) -- nunca elegivel.

    await db.flush()

    with acting_as(**ctx):
        count = await TaskService(db).archive_stale(now=NOW, actor_user_id=user, days=20)

    assert count == 2
    await db.refresh(t_done_velha)
    await db.refresh(t_done_recente)
    await db.refresh(t_cancel_velha)
    await db.refresh(t_ativa)
    assert t_done_velha.is_archived is True
    assert t_cancel_velha.is_archived is True
    assert t_done_recente.is_archived is False
    assert t_ativa.is_archived is False


async def test_history_automated_por_task_arquivada(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    velho = NOW - timedelta(days=30)
    t = await _mk(db, ws, user, team, "x")
    _set_terminal(t, status=TaskStatus.COMPLETED, completed_at=velho, when=velho)
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).archive_stale(now=NOW, actor_user_id=user, days=20)

    rows = (
        await db.execute(
            select(TaskHistory).where(
                TaskHistory.task_id == t.id,
                TaskHistory.event_type == "archived",
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].user_id == user
    assert rows[0].event_metadata == {"automated": True, "reason": "stale_terminal"}


async def test_idempotente(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    velho = NOW - timedelta(days=25)
    t = await _mk(db, ws, user, team, "x")
    _set_terminal(t, status=TaskStatus.COMPLETED, completed_at=velho, when=velho)
    await db.flush()

    with acting_as(**ctx):
        svc = TaskService(db)
        first = await svc.archive_stale(now=NOW, actor_user_id=user, days=20)
        second = await svc.archive_stale(now=NOW, actor_user_id=user, days=20)

    assert first == 1
    assert second == 0  # ja arquivada -> nao reentra


async def test_isolamento_entre_workspaces(db) -> None:
    # Varredura no WS-A nao toca task elegivel do WS-B.
    ctx_a, ws_a, team_a, user_a = await _ws_admin(db)
    _, ws_b, team_b, user_b = await _ws_admin(db)
    velho = NOW - timedelta(days=40)

    t_b = await _mk(db, ws_b, user_b, team_b, "b")
    _set_terminal(t_b, status=TaskStatus.COMPLETED, completed_at=velho, when=velho)
    await db.flush()

    with acting_as(**ctx_a):  # agindo so no WS-A
        count = await TaskService(db).archive_stale(now=NOW, actor_user_id=user_a, days=20)

    assert count == 0
    await db.refresh(t_b)
    assert t_b.is_archived is False  # WS-B intocado


async def test_filtro_archived_only(db) -> None:
    # archived_only=True traz so arquivadas; default so ativas; include traz ambas.
    from app.modules.tasks.application.task_service import TaskFilters
    from app.shared.pagination import PageParams

    ctx, ws, team, user = await _ws_admin(db)
    ativa = await _mk(db, ws, user, team, "ativa")
    arquivada = await _mk(db, ws, user, team, "arquivada")
    arquivada.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        svc = TaskService(db)
        so_arq = await svc.list_page(PageParams(page=1, size=50), TaskFilters(archived_only=True))
        so_ativas = await svc.list_page(PageParams(page=1, size=50), TaskFilters())
        ambas = await svc.list_page(PageParams(page=1, size=50), TaskFilters(include_archived=True))

    so_arq_ids = {t.id for t in so_arq.items}
    so_ativas_ids = {t.id for t in so_ativas.items}
    ambas_ids = {t.id for t in ambas.items}

    assert so_arq_ids == {arquivada.id}
    assert so_ativas_ids == {ativa.id}
    assert ambas_ids == {ativa.id, arquivada.id}
