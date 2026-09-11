"""Integração: GET /me/assignments (Entrega 6 / ADR 0017/0018)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.me_service import MeService
from app.modules.tasks.application.task_service import TaskService
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

ALL = frozenset({"assignee", "creator", "watcher"})


async def _tree(db):
    """WS com raiz R + subtimes A e B (irmãos)."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    return ws, r, a, b


def _forest(r, a, b):
    return (node(r), node(a, r), node(b, r))


async def _list(db, **kw):
    # ⚠️ `under_team_id=None` = sem recorte por time (Spec 048). Estes testes
    # sao sobre RELACAO e lente, nao sobre o recorte de tela -- ele tem arquivo
    # proprio (`test_tarefas_sob_o_time_db.py`).
    return await MeService(db).list_assignments(
        PageParams(size=100), relations=ALL, **kw, under_team_id=None
    )


# ----------------------------------------------------------
# service -- relações e filtro
# ----------------------------------------------------------
async def test_lista_uniao_das_tres_relacoes(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    proj = await f.make_project(db, workspace_id=ws, created_by=outro, team_id=a)
    t_assignee = await f.make_task(
        db, workspace_id=ws, created_by=outro, team_id=a, project_id=proj
    )
    t_creator = await f.make_task(db, workspace_id=ws, created_by=me, team_id=a, project_id=proj)
    t_watcher = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=a, project_id=proj)
    await f.make_assignment(
        db, workspace_id=ws, task_id=t_assignee.id, user_id=me, assigned_by=outro
    )
    await f.make_watcher(db, workspace_id=ws, task_id=t_watcher.id, user_id=me)
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    ids = {row.task.id for row in page.items}
    assert ids == {t_assignee.id, t_creator.id, t_watcher.id}
    assert page.total == 3


async def test_filtro_relation_assignee_only(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    proj = await f.make_project(db, workspace_id=ws, created_by=outro, team_id=a)
    t_assignee = await f.make_task(
        db, workspace_id=ws, created_by=outro, team_id=a, project_id=proj
    )
    await f.make_task(db, workspace_id=ws, created_by=me, team_id=a, project_id=proj)
    await f.make_assignment(
        db, workspace_id=ws, task_id=t_assignee.id, user_id=me, assigned_by=outro
    )
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await MeService(db).list_assignments(
            PageParams(size=100), relations=frozenset({"assignee"}), under_team_id=None)
    ids = {row.task.id for row in page.items}
    assert ids == {t_assignee.id}  # t_creator NÃO entra


async def test_mesma_task_duas_relacoes_um_item_relations_completo(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=me, team_id=a)
    t = await f.make_task(db, workspace_id=ws, created_by=me, team_id=a, project_id=proj)
    await f.make_watcher(db, workspace_id=ws, task_id=t.id, user_id=me)
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    assert len(page.items) == 1
    assert page.items[0].relations == frozenset({"creator", "watcher"})


async def test_soft_deleted_nao_aparece(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="ADMIN")
    proj = await f.make_project(db, workspace_id=ws, created_by=me, team_id=a)
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "ADMIN"),), team_tree=_forest(r, a, b)
    ):
        from app.modules.tasks.application.task_service import CreateTaskCommand

        svc = TaskService(db)
        t = await svc.create(CreateTaskCommand(
            title="x",
            project_id=proj,
            team_id=a,
            assignee_ids=[me]),
        )
        await svc.soft_delete(task_id=t.id)
        page = await _list(db)
    assert all(row.task.id != t.id for row in page.items)


# ----------------------------------------------------------
# A LENTE DE TIME, aqui como em todo o resto (Spec 037, E5/E6)
# ----------------------------------------------------------
# ⚠️ OS QUATRO TESTES DA MARCA DA ADR 0017 VIRARAM ESTES TRES, E A TROCA E A
# ENTREGA. Eles afirmavam que a task fora da lente APARECIA nesta lista com um
# booleano `True`. A ADR 0038 (E6) recusou a excecao por relacao: ser
# responsavel ou observador nao concede leitura. Sem alcance, a task nao vem.
#
# ⚠️ NAO FORAM APAGADOS, foram invertidos -- os cenarios sao os mesmos (a
# designacao feita por admin, o admin que ve tudo, a edicao que nao passa).
# Apagar deixaria a regra sem afirmacao e nada impediria a camada (B) de sumir
# de `list_my_relations` outra vez, em silencio.


async def test_designado_em_subtime_invisivel_NAO_aparece(db) -> None:
    """O cenario classico da ADR 0017: o admin me designou fora da minha lente.

    Antes: aparecia com a marca `True`. Agora: nao aparece.
    """
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    # task avulsa do subtime B (fora da minha lente {A,R}); admin me designou
    t = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=b, project_id=None)
    await f.make_assignment(db, workspace_id=ws, task_id=t.id, user_id=me, assigned_by=outro)
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    assert all(row.task.id != t.id for row in page.items)


async def test_dentro_da_lente_aparece(db) -> None:
    """O contrapeso, e ele nao e opcional.

    ⚠️ SEM ESTE TESTE, a camada (B) poderia ser escrita larga demais e sumir
    com TUDO -- o teste acima passaria verde com a lista vazia. Sao os dois
    lados do mesmo filtro.
    """
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    t = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=a, project_id=None)
    await f.make_assignment(db, workspace_id=ws, task_id=t.id, user_id=me, assigned_by=outro)
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    assert any(row.task.id == t.id for row in page.items)


async def test_admin_ve_de_qualquer_subtime(db) -> None:
    """Lente `None` = ADMIN: sem filtro de TIME (o de workspace continua).

    ⚠️ ESTE E O TESTE QUE IMPEDE `_lente_de_time` DE SER CHAMADA COM `None`.
    Escrever a camada (B) sem o `if visible is not None` barraria o admin em
    tudo -- e os dois testes acima passariam do mesmo jeito.
    """
    ws, r, a, b = await _tree(db)
    admin = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=r, role="ADMIN")
    outro = await f.make_user(db, workspace_id=ws)
    t = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=b, project_id=None)
    await f.make_assignment(db, workspace_id=ws, task_id=t.id, user_id=admin, assigned_by=outro)
    with acting_as(
        workspace_id=ws, user_id=admin, memberships=(mship(r, "ADMIN"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    assert any(row.task.id == t.id for row in page.items)


async def test_ordena_updated_at_desc(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=me, team_id=a)
    t1 = await f.make_task(
        db, workspace_id=ws, created_by=me, team_id=a, project_id=proj, title="primeira"
    )
    t2 = await f.make_task(
        db, workspace_id=ws, created_by=me, team_id=a, project_id=proj, title="segunda"
    )
    with acting_as(
        workspace_id=ws, user_id=me, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        page = await _list(db)
    ts = [row.task.updated_at for row in page.items]
    assert ts == sorted(ts, reverse=True)
    assert {t1.id, t2.id} <= {row.task.id for row in page.items}


# ----------------------------------------------------------
# fatia HTTP
# ----------------------------------------------------------
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


async def _ctx_for(ws, team, user, forest, role="OPERATOR"):
    return TenantContext(
        workspace_id=ws,
        user_id=user,
        roles=frozenset({role}),
        permissions=permissions_for_roles(frozenset({role})),
        memberships=(Membership(team_id=team, role=role),),
        team_tree=forest,
    )


async def test_http_200_default(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=me, team_id=a)
    await f.make_task(db, workspace_id=ws, created_by=me, team_id=a, project_id=proj)
    await db.commit()
    ctx = await _ctx_for(ws, a, me, _forest(r, a, b))
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/me/assignments")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    # ⚠️ O CAMPO DA ADR 0017 SAIU DO CORPO (Spec 037, E5). A assercao
    # inverteu: antes ela exigia a presenca, agora exige a AUSENCIA. E uma
    # mudanca de contrato da API, e e por isso que ela e afirmada em HTTP e
    # nao so no service -- quem consome e o front, e o que ele recebe e este
    # JSON.
    assert "out_of_scope" not in body["items"][0]
    assert "creator" in body["items"][0]["relations"]


async def test_http_relation_invalido_422(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    await db.commit()
    ctx = await _ctx_for(ws, a, me, _forest(r, a, b))
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/me/assignments", params={"relation": "xpto"})
    assert resp.status_code == 422


async def test_http_paginacao(db) -> None:
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=me, team_id=a)
    for i in range(3):
        await f.make_task(
            db, workspace_id=ws, created_by=me, team_id=a, project_id=proj, title=f"t{i}"
        )
    await db.commit()
    ctx = await _ctx_for(ws, a, me, _forest(r, a, b))
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/me/assignments", params={"page": 1, "size": 2})
    body = resp.json()
    assert resp.status_code == 200
    assert body["total"] == 3
    assert len(body["items"]) == 2


async def test_http_item_traz_assignee_ids(db) -> None:
    """Regressao: /me/assignments deve carregar assignee_ids (paridade com a
    lista do quadro, ADR 0025). Sem o campo, a tela "Minhas tarefas" reaproveita
    o item e o detalhe mostra "Ninguem designado" mesmo pra quem esta designado.

    Cenario do print: sou responsavel de uma task que NAO criei (creator=outro).
    """
    ws, r, a, b = await _tree(db)
    me = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=me, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    proj = await f.make_project(db, workspace_id=ws, created_by=outro, team_id=a)
    t = await f.make_task(
        db, workspace_id=ws, created_by=outro, team_id=a, project_id=proj
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=t.id, user_id=me, assigned_by=outro
    )
    await db.commit()
    ctx = await _ctx_for(ws, a, me, _forest(r, a, b))
    async with _client(db, ctx) as c:
        resp = await c.get("/api/v1/me/assignments")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    item = next(i for i in body["items"] if i["id"] == str(t.id))
    assert item["assignee_ids"] == [str(me)]
