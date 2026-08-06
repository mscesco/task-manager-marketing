"""F1b -- a varredura de auto-arquivamento cascateia a subarvore.

Contra Postgres real. Fecha a pendencia aberta em 04/08: ate aqui as duas
portas de arquivamento faziam coisas DIFERENTES -- o `archive` manual levava as
filhas junto (desde 05/08) e a varredura da madrugada nao levava.

Os tres casos sao os tres que a cascata pode errar:
  1. leva a filha ATIVA junto, e sem perder o status dela;
  2. NAO processa duas vezes a filha que tambem era elegivel (o caso COMUM,
     porque concluir um pai marca a subarvore inteira no mesmo instante);
  3. NAO sobe -- filha elegivel sob pai vivo nao arrasta o pai.

⚠️ UPDATE em massa nao avisa o ORM. Todo `is_archived` conferido aqui e lido do
BANCO via `db.refresh`, e nao do objeto em memoria -- senao o teste mediria
memoria e passaria com o produto quebrado.
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

# ⚠️ Importado do arquivo vizinho DE PROPOSITO, em vez de copiado. Ele carimba
# `terminal_since` com a mesma formula do backfill das migrations 0008/0009; a
# copia divergiria no dia em que a formula mudasse, e os dois arquivos passariam
# a testar regras diferentes com o mesmo nome.
from tests.integration.test_archival_db import _set_terminal

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
VELHO = NOW - timedelta(days=21)
DIAS = 20


async def _ws_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ctx, ws, team, user


async def _mk(db, ws, user, team, title, parent=None):
    return await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=team,
        title=title,
        parent=parent,
    )


async def _history(db, task_id):
    rows = (
        await db.execute(
            select(TaskHistory).where(TaskHistory.task_id == task_id)
        )
    ).scalars().all()
    return list(rows)


# 1 -- pai terminal velho arrasta a filha ATIVA, e a filha mantem o status.
#      E a decisao de 06/08. O status intacto e o que torna o desarquivar do
#      pai um retorno sem perda: `set_archived_subtree` nao toca em `status`.
async def test_cascata_leva_a_filha_ativa_e_preserva_o_status(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    pai = await _mk(db, ws, user, team, "pai concluido")
    _set_terminal(pai, status=TaskStatus.COMPLETED, completed_at=VELHO, when=VELHO)
    filha = await _mk(db, ws, user, team, "filha viva", parent=pai)
    filha.status = TaskStatus.IN_PROGRESS
    await db.flush()

    with acting_as(**ctx):
        count = await TaskService(db).archive_stale(
            now=NOW, actor_user_id=user, days=DIAS
        )

    assert count == 2  # o pai + a filha cascateada
    await db.refresh(pai)
    await db.refresh(filha)
    assert pai.is_archived is True
    assert filha.is_archived is True
    # O que prova que a volta e sem perda.
    assert filha.status == TaskStatus.IN_PROGRESS

    # History: UMA linha, no pai, com a contagem. A filha nao ganha linha
    # propria -- mesma forma do `archive` manual e do soft-delete (ADR 0005).
    linhas_pai = await _history(db, pai.id)
    assert len(linhas_pai) == 1
    assert linhas_pai[0].event_metadata == {
        "automated": True,
        "reason": "stale_terminal",
        "cascade_count": 1,
    }
    assert await _history(db, filha.id) == []


# 2 -- pai E filha elegiveis na MESMA rodada: a filha nao e processada duas
#      vezes. E o caso comum, nao a excecao: concluir um pai marca a subarvore
#      inteira como COMPLETED no mesmo instante (`complete_descendants`), entao
#      pai e filhas ficam com o mesmo `terminal_since`.
async def test_filha_tambem_elegivel_nao_e_processada_duas_vezes(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    pai = await _mk(db, ws, user, team, "pai concluido")
    _set_terminal(pai, status=TaskStatus.COMPLETED, completed_at=VELHO, when=VELHO)
    filha = await _mk(db, ws, user, team, "filha concluida", parent=pai)
    _set_terminal(
        filha, status=TaskStatus.COMPLETED, completed_at=VELHO, when=VELHO
    )
    await db.flush()

    with acting_as(**ctx):
        count = await TaskService(db).archive_stale(
            now=NOW, actor_user_id=user, days=DIAS
        )

    assert count == 2
    await db.refresh(pai)
    await db.refresh(filha)
    assert pai.is_archived is True
    assert filha.is_archived is True

    # A trava: a filha foi arquivada pela CASCATA, e nao pelo laco. Se o laco a
    # tivesse processado tambem, ela teria linha propria de history -- que o
    # arquivamento manual nunca gera.
    assert await _history(db, filha.id) == []
    linhas_pai = await _history(db, pai.id)
    assert len(linhas_pai) == 1
    assert linhas_pai[0].event_metadata["cascade_count"] == 1

    # Idempotencia com arvore: a segunda rodada nao arquiva nada.
    with acting_as(**ctx):
        segunda = await TaskService(db).archive_stale(
            now=NOW, actor_user_id=user, days=DIAS
        )
    assert segunda == 0


# 3 -- a cascata desce, nunca sobe. Filha elegivel sob pai VIVO arquiva so a
#      filha. Sem esta trava, a varredura poderia levar embora um pai em
#      andamento por causa de uma subtarefa concluida ha tres semanas.
async def test_filha_elegivel_sob_pai_vivo_nao_arrasta_o_pai(db) -> None:
    ctx, ws, team, user = await _ws_admin(db)
    pai = await _mk(db, ws, user, team, "pai vivo")  # BACKLOG, nunca elegivel
    filha = await _mk(db, ws, user, team, "filha concluida", parent=pai)
    _set_terminal(
        filha, status=TaskStatus.COMPLETED, completed_at=VELHO, when=VELHO
    )
    await db.flush()

    with acting_as(**ctx):
        count = await TaskService(db).archive_stale(
            now=NOW, actor_user_id=user, days=DIAS
        )

    assert count == 1
    await db.refresh(pai)
    await db.refresh(filha)
    assert pai.is_archived is False
    assert filha.is_archived is True

    # Folha: sem cascata, o metadata fica IDENTICO ao de antes desta fatia.
    linhas = await _history(db, filha.id)
    assert len(linhas) == 1
    assert linhas[0].event_metadata == {
        "automated": True,
        "reason": "stale_terminal",
    }
