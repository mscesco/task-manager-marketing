"""Fatia FINA de HTTP: mapeamento excecao->status (errors.py).

Via httpx ASGITransport, sobrescrevendo a sessao de banco/UoW pela sessao
de teste e a auth por um TenantContext fixo. Cobre o que o nivel de
servico nao ve: a traducao de excecao para codigo HTTP no router/errors.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TeamNode, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f

pytestmark = pytest.mark.integration


def _client(db, ctx: TenantContext) -> AsyncClient:
    """App com sessao/UoW/auth apontando para o teste."""
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
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (TeamNode(team_id=r, parent_team_id=None), TeamNode(team_id=a, parent_team_id=r))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, manager, proj, ctx


async def test_post_assignee_201_e_200_noop(db) -> None:
    ws, r, a, manager, proj, ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    await db.commit()  # fixa o seed no savepoint antes dos requests
    async with _client(db, ctx) as c:
        url = f"/api/v1/tasks/{task.id}/assignees"
        r1 = await c.post(url, json={"user_id": str(alvo)})
        r2 = await c.post(url, json={"user_id": str(alvo)})
    assert r1.status_code == 201
    assert r2.status_code == 200


async def test_assignee_inexistente_422(db) -> None:
    ws, r, a, manager, proj, ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            f"/api/v1/tasks/{task.id}/assignees", json={"user_id": str(uuid.uuid4())}
        )
    assert resp.status_code == 422


async def test_remove_assignee_ausente_404(db) -> None:
    ws, r, a, manager, proj, ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.delete(f"/api/v1/tasks/{task.id}/assignees/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_watcher_terceiro_sem_assign_403(db) -> None:
    ws, r, a, manager, proj, ctx = await _world(db)
    sem_perm = await f.make_user(db, workspace_id=ws)
    outro = await f.make_user(db, workspace_id=ws)
    avulsa = await f.make_task(db, workspace_id=ws, created_by=sem_perm, team_id=a, project_id=None)
    await db.commit()
    ctx_sem = TenantContext(workspace_id=ws, user_id=sem_perm)  # sem roles/permissoes
    async with _client(db, ctx_sem) as c:
        resp = await c.post(f"/api/v1/tasks/{avulsa.id}/watchers", json={"user_id": str(outro)})
    assert resp.status_code == 403
