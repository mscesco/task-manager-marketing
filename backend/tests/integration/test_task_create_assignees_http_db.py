"""Integracao HTTP: POST /api/v1/tasks com responsaveis na criacao (Spec 021).

POR QUE ESTE ARQUIVO EXISTE (o ponto cego que ele fecha):
    test_task_create_assignees_db.py chama TaskService.create() DIRETO, montando
    o CreateTaskCommand ja com assignee_ids na mao. Isso valida a regra do
    servico, mas NAO percorre o router -- entao nao pega o caso em que o router
    esquece de repassar payload.assignee_ids pro command (a task nasce sem
    responsavel, sem erro, e a suite continua verde). Estes testes batem no
    endpoint de verdade, via o mesmo caminho da tela.

    Guarda de regressao: no codigo QUEBRADO (router sem `assignee_ids=...`), o
    happy-path abaixo falha -- o GET do detalhe volta assignee_ids == []. Com o
    fix, volta [op_a].
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
    """App real com a sessao/UoW/tenant do teste injetados (mesmo padrao de
    test_me_assignments_db.py)."""
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


# ----------------------------------------------------------
# happy-path: a GUARDA de regressao do bug do router
# ----------------------------------------------------------
async def test_http_cria_com_assignee_valido_anexa(db) -> None:
    """POST com assignee_ids valido -> 201 e o detalhe traz o responsavel.

    Este e o teste que FALHA no codigo quebrado (assignee_ids somem no router)
    e PASSA com o fix.
    """
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
        task_id = resp.json()["id"]

        detail = await c.get(f"/api/v1/tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["assignee_ids"] == [str(op_a)]


# ----------------------------------------------------------
# a RESPOSTA do POST -- o buraco que o bug de 2026-07-27 revelou
# ----------------------------------------------------------
async def test_http_resposta_do_post_traz_assignee_ids(db) -> None:
    """O CORPO do POST traz assignee_ids -- nao so o GET seguinte.

    POR QUE ESTE TESTE EXISTE:
        test_http_cria_com_assignee_valido_anexa (acima) confere o GET do
        detalhe. Isso prova a PERSISTENCIA, e passava normalmente enquanto o
        POST devolvia `TaskResponse` -- schema sem `assignee_ids`.

        O front usa a resposta do POST para inserir o card no estado local
        (Board.aoSalvar). Sem o campo, o merge caia em `?? []` e o card nascia
        sem responsavel, embora o banco estivesse certo. A Camila reportou como
        "o responsavel nao vai"; na verdade ia, e sumia da tela.

    Guarda de regressao: voltando `response_model=TaskResponse` no router,
    este teste falha (KeyError/assert) e o de cima continua verde.
    """
    ws, a, b, manager, op_a, op_b, proj, ctx = await _setup(db)
    await db.commit()
    async with _client(db, ctx) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Resposta tem de trazer o responsavel",
                "project_id": str(proj),
                "team_id": str(a),
                "assignee_ids": [str(op_a)],
            },
        )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert "assignee_ids" in corpo, (
        "POST /tasks precisa devolver assignee_ids (TaskListItem); "
        f"veio: {sorted(corpo)}"
    )
    assert corpo["assignee_ids"] == [str(op_a)]


async def test_http_post_sem_responsavel_e_422(db) -> None:
    """⚠️ INVERTIDO EM 05/08 (ADR 0031). Antes este teste garantia que criar
    sem responsavel devolvia 201 com `assignee_ids: []`.

    ESTE e o caminho que importava fechar: e por aqui que o n8n, o Swagger e
    qualquer script criam tarefa. Enquanto a regra vivia so no modal, ela nao
    valia para nenhum deles.
    """
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
    """PATCH segue sem o campo -- a protecao do ADR 0025 continua de pe.

    Se alguem "consertar" o ADR adicionando assignee_ids ao TaskResponse
    inteiro, este teste acusa: PATCH voltaria a devolver [] e o front zeraria
    o selo ao editar, que e exatamente o que o ADR evita.
    """
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
    assert "assignee_ids" not in patch.json(), (
        "PATCH nao deve devolver assignee_ids (ADR 0025) -- o front preserva "
        "o valor do estado local no merge."
    )


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
