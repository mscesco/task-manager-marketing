"""Remocao de relacoes por perda de alcance, e a notificacao, pela rota.

Quando a mudanca de vinculo e permitida, a pessoa sai como responsavel e como
observadora das tarefas que deixou de alcancar, e recebe uma notificacao com a
contagem e os subtimes.

Os testes da remocao conferem o banco, nao a resposta: a notificacao pode
anunciar a contagem certa com as designacoes ainda la.

O conjunto da remocao e maior que o do bloqueio: o bloqueio olha so tarefa
nao terminal de responsavel unico; a remocao leva tambem terminal, tarefa com
colega e observador (`test_terminal_e_observador_tambem_saem`).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import TenantContext, set_tenant
from app.db.models import Notification, TaskAssignment, TaskWatcher
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import node

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


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS F4")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    ator = await f.make_user(
        db, workspace_id=ws, email="ator@t.dev", org_role="ADMIN"
    )
    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gi, team_id=design, role="OPERATOR"
    )
    colega = await f.make_user(db, workspace_id=ws, email="colega@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=colega, team_id=design, role="OPERATOR"
    )

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=ator,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=arvore, org_role="ADMIN"
        ),
        team_tree=arvore,
        org_role="ADMIN",
    )

    return {
        "ws": ws, "raiz": raiz, "seo": seo, "design": design,
        "ator": ator, "gi": gi, "colega": colega, "ctx": ctx,
    }


async def _tarefa(db, m, *, time, titulo, status=TaskStatus.BACKLOG,
                  responsaveis=(), observadores=()):
    t = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"],
        team_id=time, title=titulo, status=status,
    )
    for u in responsaveis:
        await f.make_assignment(
            db, workspace_id=m["ws"], task_id=t.id, user_id=u,
            assigned_by=m["ator"],
        )
    for u in observadores:
        await f.make_watcher(db, workspace_id=m["ws"], task_id=t.id, user_id=u)
    return t


async def _mover(db, m):
    """Tira a `gi` do Design pela rota, deixando-a no SEO (vinculo da factory)."""
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["seo"],
        role="OPERATOR",
    )
    async with _client(db, m["ctx"]) as cli:
        return await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )


async def _responsaveis(db, task_id) -> set[uuid.UUID]:
    return set(
        (
            await db.execute(
                select(TaskAssignment.user_id).where(
                    TaskAssignment.task_id == task_id
                )
            )
        ).scalars().all()
    )


async def _observadores(db, task_id) -> set[uuid.UUID]:
    return set(
        (
            await db.execute(
                select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)
            )
        ).scalars().all()
    )


async def _notificacoes(db, user_id) -> list[Notification]:
    return list(
        (
            await db.execute(
                select(Notification).where(
                    Notification.recipient_id == user_id,
                    Notification.type == "ACCESS_LOST",
                )
            )
        ).scalars().all()
    )


# ------------------------------------------ 1. a remocao, conferida no banco


async def test_movimentacao_permitida_remove_a_designacao(db) -> None:
    """A `gi` divide a tarefa com a `colega`, entao o bloqueio nao age (a
    tarefa nao ficaria orfa); a remocao tira a `gi` e deixa a `colega`."""
    m = await _mundo(db)
    t = await _tarefa(
        db, m, time=m["design"], titulo="Arte a quatro maos",
        responsaveis=(m["gi"], m["colega"]),
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _responsaveis(db, t.id) == {m["colega"]}


async def test_terminal_e_observador_tambem_saem(db) -> None:
    """Duas tarefas que o bloqueio nunca barraria (terminal de responsavel
    unico; so observadora): a remocao leva as duas. Cai se a remocao reusar o
    predicado do bloqueio."""
    m = await _mundo(db)
    terminal = await _tarefa(
        db, m, time=m["design"], titulo="Ja entregue",
        status=TaskStatus.COMPLETED, responsaveis=(m["gi"],),
    )
    observada = await _tarefa(
        db, m, time=m["design"], titulo="So acompanho",
        responsaveis=(m["colega"],), observadores=(m["gi"],),
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    # Terminal pode ficar sem responsavel; a obrigatoriedade vale na criacao.
    assert await _responsaveis(db, terminal.id) == set()
    assert await _observadores(db, observada.id) == set()
    assert await _responsaveis(db, observada.id) == {m["colega"]}

    # Sair como seguidor entra no historico, tambem quando quem tira e o vinculo.
    linhas = (
        await db.execute(
            text(
                "SELECT metadata FROM task_history "
                "WHERE task_id=:t AND event_type='unwatched'"
            ),
            {"t": observada.id},
        )
    ).scalars().all()
    assert linhas == [
        {"target_user_id": str(m["gi"]), "by_self": False, "reason": "lost_access"}
    ]


async def test_raiz_e_subtime_mantido_nao_mudam(db) -> None:
    """O que ela continua alcancando fica intocado."""
    m = await _mundo(db)
    na_raiz = await _tarefa(
        db, m, time=m["raiz"], titulo="Tarefa geral", responsaveis=(m["gi"],)
    )
    no_destino = await _tarefa(
        db, m, time=m["seo"], titulo="Tarefa do SEO", responsaveis=(m["gi"],)
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _responsaveis(db, na_raiz.id) == {m["gi"]}
    assert await _responsaveis(db, no_destino.id) == {m["gi"]}


# ------------------------------------------------------ 2. a notificacao


async def test_a_contagem_da_notificacao_bate(db) -> None:
    """Tres tarefas perdidas: uma notificacao so, `quantidade == 3` e o subtime.

    Afirma a contagem, nao a remocao; quem olha o banco e
    `test_movimentacao_permitida_remove_a_designacao`.
    """
    m = await _mundo(db)
    for i in range(3):
        await _tarefa(
            db, m, time=m["design"], titulo=f"Tarefa {i}",
            responsaveis=(m["gi"], m["colega"]),
        )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    notifs = await _notificacoes(db, m["gi"])
    assert len(notifs) == 1
    assert notifs[0].payload["quantidade"] == 3
    assert notifs[0].payload["subtimes"] == ["design"]
    # Sem `task_id`: fala de um conjunto, e um link levaria a um 404.
    assert notifs[0].task_id is None


async def test_sem_perda_nao_notifica(db) -> None:
    """Movimentacao que nao tira nada de ninguem nao gera aviso nenhum."""
    m = await _mundo(db)
    await _tarefa(
        db, m, time=m["raiz"], titulo="Tarefa geral", responsaveis=(m["gi"],)
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _notificacoes(db, m["gi"]) == []
