"""Serializacao de completed_at no PATCH/POST de status.

⚠️ `completed_at` precisa ser um valor concreto, e nao `func.now()`: uma
expressao SQL nao resolvida faz o SQLAlchemy async buscar o valor tarde, ao
serializar a resposta -> MissingGreenlet -> 500. Estes testes batem o
endpoint real, unico caminho onde o erro aparece.
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership, TeamNode, TenantContext
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import cliente

pytestmark = pytest.mark.integration


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
    async with cliente(db, ctx) as c:
        resp = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "COMPLETED"})
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is not None


async def test_patch_status_saindo_de_completed_zera_completed_at(db) -> None:
    ws, r, a, manager, ctx = await _world(db)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=None)
    await db.commit()
    async with cliente(db, ctx) as c:
        r1 = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "COMPLETED"})
        r2 = await c.patch(f"/api/v1/tasks/{task.id}", json={"status": "IN_PROGRESS"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json()["completed_at"] is None


async def test_post_task_ja_completed_201_e_completed_at_setado(db) -> None:
    ws, r, a, manager, ctx = await _world(db)
    await db.commit()
    async with cliente(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "ja concluida",
                "team_id": str(a),
                "status": "COMPLETED",
                # Responsavel obrigatorio tambem no POST HTTP.
                "assignee_ids": [str(manager)],
            },
        )
    assert resp.status_code == 201
    assert resp.json()["completed_at"] is not None