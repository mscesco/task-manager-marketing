"""`parent_title` em /me/assignments: o selo "Subtarefa de X".

"Minhas tarefas" mostra subtarefa como card solto, e a mae muitas vezes nao
esta na lista. Por isso o titulo vem do backend, em lote.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

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
    """WS com raiz, um operador, um projeto e uma task-mae com uma filha."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=raiz, role="OPERATOR"
    )
    # Dono separado: se o proprio `op` criasse as tasks, elas entrariam em
    # /me/assignments pela relacao "creator" e o cenario-alvo (estar so na
    # filha) nunca aconteceria.
    dono = await f.make_user(db, workspace_id=ws, email="dono@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dono, team_id=raiz, role="MANAGER"
    )
    proj = await f.make_project(db, workspace_id=ws, created_by=dono, team_id=raiz)
    mae = await f.make_task(
        db, workspace_id=ws, project_id=proj, created_by=dono,
        team_id=raiz, title="Campanha Black Friday",
    )
    filha = await f.make_task(
        db, workspace_id=ws, project_id=proj, created_by=dono,
        team_id=raiz, title="Peca para Instagram", parent=mae,
    )
    ctx = TenantContext(
        workspace_id=ws,
        user_id=op,
        roles=frozenset({"OPERATOR"}),
        permissions=permissions_for_roles(frozenset({"OPERATOR"})),
        memberships=(Membership(team_id=raiz, role="OPERATOR"),),
        team_tree=(node(raiz),),
    )
    return {"ws": ws, "raiz": raiz, "op": op, "dono": dono, "proj": proj,
            "mae": mae, "filha": filha, "ctx": ctx}


def _client(db, ctx):
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


async def _designar(db, c, task):
    """make_assignment exige workspace_id e assigned_by (insere direto)."""
    await f.make_assignment(
        db, workspace_id=c["ws"], task_id=task.id,
        user_id=c["op"], assigned_by=c["dono"],
    )


def _por_id(corpo, task):
    """`task` e o objeto Task devolvido pela factory."""
    return next(i for i in corpo["items"] if i["id"] == str(task.id))


async def test_parent_title_quando_a_mae_NAO_esta_na_minha_lista(db) -> None:
    """Designada so na filha: a mae nao esta na lista, e o titulo vem mesmo
    assim."""
    c = await _setup(db)
    await _designar(db, c, c["filha"])
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.get("/api/v1/me/assignments")
    assert r.status_code == 200, r.text
    corpo = r.json()
    ids = {i["id"] for i in corpo["items"]}
    assert str(c["mae"].id) not in ids, "a mae nao deveria estar na lista"
    assert _por_id(corpo, c["filha"])["parent_title"] == "Campanha Black Friday"


async def test_parent_title_quando_a_mae_ESTA_na_lista(db) -> None:
    """Designada nas duas: a filha traz o titulo, a mae traz None."""
    c = await _setup(db)
    await _designar(db, c, c["mae"])
    await _designar(db, c, c["filha"])
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.get("/api/v1/me/assignments")
    corpo = r.json()
    assert _por_id(corpo, c["filha"])["parent_title"] == "Campanha Black Friday"
    assert _por_id(corpo, c["mae"])["parent_title"] is None


async def test_task_raiz_tem_parent_title_none(db) -> None:
    """Sem mae -> None, nunca string vazia (o front decide o rotulo)."""
    c = await _setup(db)
    await _designar(db, c, c["mae"])
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.get("/api/v1/me/assignments")
    item = _por_id(r.json(), c["mae"])
    assert item["parent_task_id"] is None
    assert item["parent_title"] is None


async def test_neto_traz_a_mae_DIRETA_nao_a_raiz(db) -> None:
    """So a mae direta. A cadeia fica no detalhe."""
    c = await _setup(db)
    neta = await f.make_task(
        db, workspace_id=c["ws"], project_id=c["proj"], created_by=c["dono"],
        team_id=c["raiz"], title="Ajuste de cor", parent=c["filha"],
    )
    await _designar(db, c, neta)
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.get("/api/v1/me/assignments")
    assert _por_id(r.json(), neta)["parent_title"] == "Peca para Instagram"


async def test_lote_nao_faz_n_mais_1(db, connection) -> None:
    """Os titulos das maes saem em lote: a pagina faz o mesmo numero de
    consultas com 1 ou com 4 subtarefas de maes diferentes, e cada filha traz
    o titulo certo."""
    from sqlalchemy import event

    c = await _setup(db)

    async def _filhas(n: int, desde: int) -> dict:
        esperado = {}
        for i in range(desde, desde + n):
            mae = await f.make_task(
                db, workspace_id=c["ws"], project_id=c["proj"], created_by=c["dono"],
                team_id=c["raiz"], title=f"Mae {i}",
            )
            filha = await f.make_task(
                db, workspace_id=c["ws"], project_id=c["proj"], created_by=c["dono"],
                team_id=c["raiz"], title=f"Filha {i}", parent=mae,
            )
            await _designar(db, c, filha)
            esperado[filha] = f"Mae {i}"
        await db.commit()
        return esperado

    async def _get() -> tuple[int, dict]:
        sqls: list[str] = []

        def _anota(conn, cursor, statement, *args) -> None:
            sqls.append(statement)

        event.listen(connection.sync_connection, "before_cursor_execute", _anota)
        try:
            async with _client(db, c["ctx"]) as cli:
                r = await cli.get("/api/v1/me/assignments?size=50")
        finally:
            event.remove(connection.sync_connection, "before_cursor_execute", _anota)
        assert r.status_code == 200, r.text
        return len(sqls), r.json()

    await _filhas(1, 0)
    com_uma, _ = await _get()
    esperado = await _filhas(4, 1)
    com_cinco, corpo = await _get()

    assert com_cinco == com_uma
    for filha, titulo in esperado.items():
        assert _por_id(corpo, filha)["parent_title"] == titulo
