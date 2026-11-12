"""Cascata de conclusao (pai concluido -> subtree concluida) + updated_at.

Regra: concluir um PAI (transicao PARA COMPLETED) conclui toda a subtree
via UPDATE em massa por ltree, PULANDO descendentes ja COMPLETED, CANCELLED
e arquivados. Vive no backend (vale pra quadro/modal/API).

Regressao coberta aqui: o UPDATE textual NAO dispara o onupdate do ORM, entao
`updated_at` dos descendentes cascateados ficava velho (bug). O fix seta
`updated_at = NOW()` no proprio SQL.

Nota de harness: o `db` roda tudo numa transacao externa (savepoints), entao
`NOW()` == `transaction_timestamp()` e CONSTANTE no teste inteiro -- assercao
por "hora nova > hora velha" nao distingue nada aqui. Por isso o setup marca
`updated_at` das subs com uma SENTINELA antiga e o teste checa se a cascata
sobrescreveu (cascateada) ou deixou intacta (pulada).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import Membership, TeamNode, TenantContext
from app.db.models import Task
from app.db.models.enums import TaskStatus
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import cliente

pytestmark = pytest.mark.integration

# Sentinela: data claramente anterior ao teste. Se a cascata escrever
# updated_at, o valor deixa de ser esta sentinela; se pular, permanece.
_SENTINELA = datetime(2020, 1, 1, tzinfo=UTC)

_World = tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, TenantContext]


async def _world(db: AsyncSession) -> _World:
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER"
    )
    forest = (
        TeamNode(team_id=r, parent_team_id=None),
        TeamNode(team_id=a, parent_team_id=r),
    )
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, manager, ctx


async def _set_updated_at_sentinela(db: AsyncSession, *tasks: Task) -> None:
    """Marca updated_at das tasks com a sentinela. Explicito -> vence o
    onupdate do ORM neste flush (onupdate so age em coluna nao setada a mao)."""
    for t in tasks:
        t.updated_at = _SENTINELA
    await db.flush()


async def _reload(db: AsyncSession, task_id: uuid.UUID) -> Task:
    """Reforca leitura do banco. expire_on_commit=False + UPDATE textual
    (fora do identity map) => o objeto em memoria fica velho; refresh rele."""
    obj = await db.get(Task, task_id)
    assert obj is not None
    await db.refresh(obj)
    return obj


async def test_concluir_pai_cascateia_subs_e_bumpa_updated_at(
    db: AsyncSession,
) -> None:
    ws, r, a, manager, ctx = await _world(db)

    pai = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=None
    )
    # Sub direta (profundidade 1) e neta (profundidade 2) -> cobre o <@ ltree
    # pegando a subtree inteira, nao so o primeiro nivel.
    sub = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=pai
    )
    neta = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=sub
    )
    sub.status = TaskStatus.IN_PROGRESS
    neta.status = TaskStatus.BACKLOG
    await _set_updated_at_sentinela(db, sub, neta)
    await db.commit()

    async with cliente(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/tasks/{pai.id}", json={"status": "COMPLETED"}
        )
    assert resp.status_code == 200

    sub_db = await _reload(db, sub.id)
    neta_db = await _reload(db, neta.id)

    # Cascateadas: viraram COMPLETED, ganharam completed_at, e updated_at foi
    # SOBRESCRITO (deixou de ser a sentinela). Este ultimo e o fix.
    for x in (sub_db, neta_db):
        assert x.status == TaskStatus.COMPLETED
        assert x.completed_at is not None
        assert x.updated_at != _SENTINELA, (
            "updated_at ficou velho: o UPDATE em massa nao bumpou (bug do "
            "onupdate que nao dispara em SQL textual)."
        )


async def test_cascata_pula_cancelada_arquivada_e_ja_concluida(
    db: AsyncSession,
) -> None:
    ws, r, a, manager, ctx = await _world(db)

    pai = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, project_id=None
    )
    normal = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=pai
    )
    cancelada = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=pai
    )
    arquivada = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=pai
    )
    ja_concluida = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=a, parent=pai
    )

    normal.status = TaskStatus.IN_PROGRESS
    cancelada.status = TaskStatus.CANCELLED
    arquivada.status = TaskStatus.IN_PROGRESS
    arquivada.is_archived = True
    ja_concluida.status = TaskStatus.COMPLETED
    ja_concluida.completed_at = _SENTINELA
    await _set_updated_at_sentinela(
        db, normal, cancelada, arquivada, ja_concluida
    )
    await db.commit()

    async with cliente(db, ctx) as c:
        resp = await c.patch(
            f"/api/v1/tasks/{pai.id}", json={"status": "COMPLETED"}
        )
    assert resp.status_code == 200

    # Normal: cascateada.
    normal_db = await _reload(db, normal.id)
    assert normal_db.status == TaskStatus.COMPLETED
    assert normal_db.updated_at != _SENTINELA

    # Puladas: status intacto E updated_at intacto (a sentinela sobrevive ->
    # prova que a linha nao foi tocada pelo UPDATE em massa).
    cancelada_db = await _reload(db, cancelada.id)
    assert cancelada_db.status == TaskStatus.CANCELLED
    assert cancelada_db.updated_at == _SENTINELA

    arquivada_db = await _reload(db, arquivada.id)
    assert arquivada_db.status == TaskStatus.IN_PROGRESS
    assert arquivada_db.is_archived is True
    assert arquivada_db.updated_at == _SENTINELA

    ja_db = await _reload(db, ja_concluida.id)
    assert ja_db.status == TaskStatus.COMPLETED
    # completed_at NAO foi re-tocado (continua a sentinela): a cascata pulou.
    assert ja_db.completed_at == _SENTINELA
    assert ja_db.updated_at == _SENTINELA
