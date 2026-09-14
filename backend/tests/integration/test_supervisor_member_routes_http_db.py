"""Spec 028 pela ROTA -- o ponto cego que test_supervisor_member_scope_db deixa.

POR QUE ESTE ARQUIVO EXISTE:
    test_supervisor_member_scope_db.py chama o MemberService DIRETO. Isso prova
    as travas D1/D2, mas NAO percorre o router -- entao nao pega a metade da
    spec que mora no gate da rota.

    Concretamente: se alguem reverter
        require_any_permission("team.manage", "member.manage.subteam")
    para
        require_permission("team.manage")
    em users/api/router.py, TODOS aqueles 11 testes continuam verdes e a
    funcionalidade some -- o supervisor leva 403 na porta e nada acusa. E a
    armadilha do §8 do handoff: teste que passa contra o codigo quebrado.

    Guarda de regressao: no gate revertido, `test_http_supervisor_adiciona` e
    `test_http_supervisor_remove` falham com 403.

O que cada bloco cobre:
    portas ABERTAS   -- POST /{id}/team e DELETE /{id}/teams/{tid}
    porta FECHADA    -- POST /{id}/deactivate segue exigindo team.manage (D4)
    trava pela rota  -- D1 e D2 continuam valendo no caminho HTTP
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _setup(db):
    """Raiz + dois subtimes; um supervisor em SEO; um operador solto na raiz."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    crm = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    sup = await f.make_user(db, workspace_id=ws, email="sup@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=raiz, role="OPERATOR"
    )

    # ⚠️ PERMISSOES COM ESCOPO (Spec 049, fatia B). Com `permissions_for_roles`
    # (um `frozenset`), `test_http_trava_d1_outro_subtime` so dava 403 porque a
    # trava recalculava "onde sou supervisor" a mao. Ela passou a perguntar a
    # permissao -- e o contexto do teste tem de ser o da requisicao de verdade.
    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))
    vinculos = (Membership(team_id=seo, role="SUPERVISOR"),)
    ctx = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
        memberships=vinculos,
        team_tree=arvore,
    )
    return {"ws": ws, "raiz": raiz, "seo": seo, "crm": crm,
            "sup": sup, "op": op, "ctx": ctx}


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados."""
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


# ------------------------------------------------ portas ABERTAS pela spec


async def test_http_supervisor_adiciona(db) -> None:
    """POST /members/{id}/team com token de SUPERVISOR -> 201.

    FALHA (403) se o gate da rota voltar a exigir so `team.manage`.
    """
    c = await _setup(db)
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{c['op']}/team",
            json={"team_id": str(c["seo"]), "role": "OPERATOR"},
        )
    assert r.status_code == 201, r.text
    assert r.json()["team_id"] == str(c["seo"])


async def test_http_supervisor_remove(db) -> None:
    """DELETE /members/{id}/teams/{tid} com token de SUPERVISOR -> 204.

    FALHA (403) se o gate da rota voltar a exigir so `team.manage`.
    """
    c = await _setup(db)
    await f.add_member(
        db, workspace_id=c["ws"], user_id=c["op"],
        team_id=c["seo"], role="OPERATOR",
    )
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{c['op']}/teams/{c['seo']}"
        )
    assert r.status_code == 204, r.text


# ------------------------------------------------ travas valendo pela rota


async def test_http_trava_d1_outro_subtime(db) -> None:
    """D1 pelo caminho HTTP: outro subtime -> 403.

    Prova que abrir a porta NAO afrouxou a regra: o gate da rota deixa entrar,
    o service e quem recusa.
    """
    c = await _setup(db)
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{c['op']}/team",
            json={"team_id": str(c["crm"]), "role": "OPERATOR"},
        )
    assert r.status_code == 403, r.text


async def test_http_trava_d2_papel_acima(db) -> None:
    """D2 pelo caminho HTTP: papel acima de OPERATOR -> 403."""
    c = await _setup(db)
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{c['op']}/team",
            json={"team_id": str(c["seo"]), "role": "SUPERVISOR"},
        )
    assert r.status_code == 403, r.text


# ------------------------------------------------ portas que seguem FECHADAS


@pytest.mark.parametrize(
    "metodo,caminho,corpo",
    [
        ("post", "/api/v1/members/{op}/deactivate", None),           # D4
        ("post", "/api/v1/members/{op}/reset-password", None),       # D3
        ("post", "/api/v1/members", {                                # D3
            "name": "X", "email": "x@t.dev",
            "team_id": "{seo}", "role": "OPERATOR",
        }),
    ],
)
async def test_http_rotas_fechadas_ao_supervisor(
    db, metodo, caminho, corpo
) -> None:
    """Rotas que a Spec 028 NAO abriu continuam exigindo `team.manage`.

    Este teste e o par do de cima: sem ele, alguem poderia abrir TODAS as
    rotas de membro ao supervisor e a suite nao reclamaria.
    """
    c = await _setup(db)
    await db.commit()
    url = caminho.format(op=c["op"], seo=c["seo"])
    if corpo:
        corpo = {
            k: (v.format(seo=c["seo"]) if isinstance(v, str) else v)
            for k, v in corpo.items()
        }
    async with _client(db, c["ctx"]) as cli:
        r = await getattr(cli, metodo)(url, json=corpo)
    assert r.status_code == 403, f"{url} devia recusar: {r.text}"


async def test_http_move_subteam_fechado(db) -> None:
    """Mover entre subtimes segue fechado (toca o subtime de origem)."""
    c = await _setup(db)
    await f.add_member(
        db, workspace_id=c["ws"], user_id=c["op"],
        team_id=c["crm"], role="OPERATOR",
    )
    await db.commit()
    async with _client(db, c["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{c['op']}/move-subteam",
            json={"from_team_id": str(c["crm"]), "to_team_id": str(c["seo"])},
        )
    assert r.status_code == 403, r.text


# ------------------------------------------------ sem regressao


async def test_http_manager_segue_amplo(db) -> None:
    """MANAGER continua passando nas rotas fechadas ao supervisor."""
    c = await _setup(db)
    mgr = await f.make_user(db, workspace_id=c["ws"], email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=mgr,
        team_id=c["raiz"], role="MANAGER",
    )
    await db.commit()
    arvore = (node(c["raiz"]), node(c["seo"], c["raiz"]), node(c["crm"], c["raiz"]))
    vinculos = (Membership(team_id=c["raiz"], role="MANAGER"),)
    ctx = TenantContext(
        workspace_id=c["ws"],
        user_id=mgr,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
        memberships=vinculos,
        team_tree=arvore,
    )
    async with _client(db, ctx) as cli:
        r = await cli.post(f"/api/v1/members/{c['op']}/deactivate")
    assert r.status_code in (200, 204), r.text
