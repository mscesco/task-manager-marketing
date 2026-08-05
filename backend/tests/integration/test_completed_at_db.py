"""Regressao: serializacao de completed_at no PATCH/POST de status.

O bug (E9-escrita): task.completed_at = func.now() era uma expressao SQL
nao resolvida; ao serializar TaskResponse (Pydantic) o SQLAlchemy async
tentava buscar o valor tarde -> MissingGreenlet -> 500. Corrigido usando
datetime.now(timezone.utc), um valor concreto. Estes testes batem o
endpoint real (unico caminho onde o erro aparece).
"""

from __future__ import annotations

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
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx():
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
    forest = (TeamNode(team_id=r, parent_team_id=None), TeamNode(team_id=a, parent_team_id=r))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )
    return ws, r, a, manager, ctx


async def test_patch_status_para_completed_200_e_completed_at_setado(db) -> None:
    ws, r, a, manager, ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=None)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "COMPLETED"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is not None


async def test_patch_status_saindo_de_completed_zera_completed_at(db) -> None:
    ws, r, a, manager, ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=None)
    await db.commit()
    async with _client(db, ctx) as c:
        r1 = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "COMPLETED"})
        r2 = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "IN_PROGRESS"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json()["completed_at"] is None


async def test_post_task_ja_completed_201_e_completed_at_setado(db) -> None:
    ws, r, a, manager, ctx = await _world(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "ja concluida",
                "team_id": str(a),
                "status": "COMPLETED",
                # ADR 0031: responsavel obrigatorio tambem no POST HTTP.
                "assignee_ids": [str(manager)],
            },
        )
    assert resp.status_code == 201
    assert resp.json()["completed_at"] is not None