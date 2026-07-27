"""Selo "Subtarefa de X" em /me/assignments (pedido da equipe, 2026-07-27).

POR QUE ESTA TELA E SO ELA:
    "Minhas tarefas" e a UNICA que mostra subtarefa como card SOLTO. O quadro
    geral lista so raizes (ADR 0004) e a subtarefa aparece DENTRO do card da
    mae, onde o contexto e obvio. Solta, ela so dizia "Subtarefa" -- sem
    dizer de que.

O QUE MAIS IMPORTA AQUI:
    `test_parent_title_quando_a_mae_NAO_esta_na_minha_lista`. Resolver o
    titulo no front, procurando a mae entre os itens carregados, funcionaria
    so quando a pessoa ja esta designada na mae -- ou seja, quando ela ja
    sabe o contexto. Falharia justamente no caso em que o selo e util: estar
    designada SO na filha. Por isso o titulo vem do backend, em lote.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
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
    """O CASO QUE JUSTIFICA A SPEC: designada so na filha.

    A mae nao entra em /me/assignments (nao tenho relacao com ela), entao
    resolver o titulo no front pela lista carregada devolveria nada. O selo
    tem de vir do backend.
    """
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
    """Decisao da Camila: so a mae direta. A cadeia fica no detalhe."""
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


async def test_lote_nao_faz_n_mais_1(db) -> None:
    """Varias subtarefas de maes DIFERENTES numa pagina so.

    Nao mede query (a suite nao instrumenta), mas trava o contrato: todas as
    maes resolvem numa chamada. Se alguem trocar o lote por um get por card,
    este teste segue verde -- por isso o docstring do repo e do router
    registram o porque do lote. O que ele garante e a CORRETUDE do lote:
    varias maes distintas, cada filha com o titulo certo.
    """
    c = await _setup(db)
    esperado = {}
    for i in range(4):
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
    async with _client(db, c["ctx"]) as cli:
        r = await cli.get("/api/v1/me/assignments?size=50")
    corpo = r.json()
    for filha, titulo in esperado.items():
        assert _por_id(corpo, filha)["parent_title"] == titulo
