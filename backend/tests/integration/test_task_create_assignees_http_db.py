"""POST /api/v1/tasks com responsaveis na criacao, pelo router.

Pega o router que esquece de repassar `payload.assignee_ids` ao command (a
task nasceria sem responsavel e sem erro), o que o teste de service nao ve.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _setup(db):
    """WS com raiz R + subtimes A e B; manager de R (cria/edita a subarvore);
    projeto comum no time A; op_a alcanca A; op_b so alcanca B.

    Retorna tambem um TenantContext do manager para o client HTTP.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (node(r), node(a, r), node(b, r))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=manager,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )
    return ws, a, b, manager, op_a, op_b, proj, ctx


def _client(db, ctx):
    """App real com a sessao/UoW/tenant do teste injetados."""
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


async def _count_tasks(db, ws):
    return (
        await db.execute(
            text("SELECT count(*) FROM task WHERE workspace_id=:w"), {"w": ws}
        )
    ).scalar_one()


async def test_http_cria_com_assignee_valido_anexa(db) -> None:
    """POST com assignee_ids valido -> 201; o corpo e o GET seguinte trazem o
    responsavel. O front usa o corpo do POST para inserir o card."""
    ws, a, b, manager, op_a, op_b, proj, ctx = await _setup(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Com responsavel via HTTP",
                "project_id": str(proj),
                "team_id": str(a),
                "assignee_ids": [str(op_a)],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json().get("assignee_ids") == [str(op_a)]

        detail = await c.get(f"/api/v1/tasks/{resp.json()['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["assignee_ids"] == [str(op_a)]


async def test_http_post_sem_responsavel_e_422(db) -> None:
    """Criar sem responsavel e recusado na API, nao so no modal."""
    ws, a, b, manager, op_a, op_b, proj, ctx = await _setup(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={"title": "Sem ninguem", "project_id": str(proj), "team_id": str(a)},
        )
    assert resp.status_code == 422, resp.text
    assert "responsável" in resp.text


async def test_http_patch_NAO_traz_assignee_ids(db) -> None:
    """PATCH nao devolve assignee_ids: se devolvesse, viria [] e o front
    zeraria o selo de responsavel ao editar."""
    ws, a, b, manager, op_a, op_b, proj, ctx = await _setup(db)
    await db.commit()
    async with _client(db, ctx) as c:
        criada = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Para editar",
                "project_id": str(proj),
                "team_id": str(a),
                "assignee_ids": [str(op_a)],
            },
        )
        assert criada.status_code == 201, criada.text
        patch = await c.patch(
            f"/api/v1/tasks/{criada.json()['id']}",
            json={"title": "Titulo novo"},
        )
    assert patch.status_code == 200, patch.text
    assert "assignee_ids" not in patch.json()


# ----------------------------------------------------------
# erro atravessa o router: o front depende de details.invalid_ids
# ----------------------------------------------------------
async def test_http_cria_com_assignee_invalido_422_nomeia_e_nao_persiste(db) -> None:
    """POST com responsavel que nao alcanca o time -> 422 nomeando o invalido,
    e NENHUMA task persiste (atomicidade ponta-a-ponta pela requisicao)."""
    ws, a, b, manager, op_a, op_b, proj, ctx = await _setup(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Invalido via HTTP",
                "project_id": str(proj),
                "team_id": str(a),
                "assignee_ids": [str(op_b)],  # op_b so alcanca B
            },
        )
    assert resp.status_code == 422, resp.text
    details = resp.json()["error"]["details"]
    assert details["invalid_ids"] == [str(op_b)]
    # A requisicao inteira reverteu: nada de task no workspace.
    assert await _count_tasks(db, ws) == 0
