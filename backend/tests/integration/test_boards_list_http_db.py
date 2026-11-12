"""`GET /api/v1/boards` pela lente (`visible_team_ids`).

POR QUE PELA ROTA, E NAO PELO SERVICO: teste que chama o repositorio/servico
direto nao percorre o gate da rota. Se alguem trocar a dependencia no router,
os testes de servico seguem verdes.

A LENTE (`team_scope.visible_team_ids`):
  - ADMIN (de org.)  -> `None` = todos os times (do PROPRIO workspace);
  - MANAGER da raiz  -> raiz + descendentes;
  - SUPERVISOR/OPERATOR de X -> X + raiz: ve o quadro geral e os do proprio
    subtime, e NAO os de outro subtime.

⚠️ O `None` do ADMIN e o ponto perigoso. "Todos os times" NAO e "todos os
workspaces": um `if lente is None: sem filtro` que esqueca o `workspace_id` vaza
quadro de outro tenant SO para o ADMIN. Por isso a contagem exata roda como
ADMIN, com um quadro de outro workspace no banco.

O MUNDO (montado em `_setup`):
    workspace A: raiz Marketing (quadro GERAL, nasce com o time)
                 + subtime SEO   -> quadro interno
                 + subtime CRM   -> quadro interno
                 + um quadro do SEO APAGADO (`deleted_at`)
    workspace B: outra raiz, com o quadro geral dela -- o que poderia vazar.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import (
    permissions_for_actor,
    permissions_for_roles,
)
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------- o mundo


async def _setup(db):
    """Dois workspaces. No A: raiz + SEO + CRM, um quadro interno em cada
    subtime, e mais um quadro do SEO ja apagado.
    """
    # ---- workspace A
    ws = await f.make_workspace(db, name="WS A")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    crm = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    # O quadro GERAL ja existe: `make_team` da raiz o cria (ver docstring).
    interno_seo = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Interno SEO"
    )
    interno_crm = await f.make_board(
        db, workspace_id=ws, team_id=crm, name="Interno CRM"
    )

    # Quadro APAGADO, na mao: o teste precisa do estado, nao do caminho.
    apagado_seo = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Interno SEO APAGADO"
    )
    apagado_seo.deleted_at = datetime.now(UTC)
    await db.flush()

    # ---- workspace B, so para ter o que vazar
    ws_b = await f.make_workspace(db, name="WS B")
    raiz_b = await f.make_team(db, workspace_id=ws_b, slug="outra-raiz")

    # ---- gente
    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    # ADMIN e papel de ORGANIZACAO: sem vinculo de time.
    adm = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )

    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))

    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    ctx_adm = TenantContext(
        workspace_id=ws,
        user_id=adm,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=arvore, org_role="ADMIN"
        ),
        team_tree=arvore,
        org_role="ADMIN",
    )

    return {
        "ws": ws,
        "ws_b": ws_b,
        "raiz": raiz,
        "raiz_b": raiz_b,
        "seo": seo,
        "crm": crm,
        "interno_seo": interno_seo,
        "interno_crm": interno_crm,
        "apagado_seo": apagado_seo,
        "ctx_sup": ctx_sup,
        "ctx_adm": ctx_adm,
    }


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


async def _ids(cli) -> set[uuid.UUID]:
    """Chama a rota e devolve o conjunto de ids, ja como UUID.

    ⚠️ Compara UUID com UUID. Comparar `str` com `str` esconde diferenca de
    formatacao (hifen, caixa) como se fosse diferenca de conteudo -- e o
    contrario tambem: um id certo formatado diferente derrubaria o teste por
    motivo nenhum ligado ao produto.
    """
    r = await cli.get("/api/v1/boards")
    assert r.status_code == 200, r.text
    return {uuid.UUID(q["id"]) for q in r.json()}


# ------------------------------------------------------- 1. a lente restringe


async def test_supervisor_do_seo_nao_ve_quadro_interno_do_crm(db) -> None:
    """SUPERVISOR do SEO ve o quadro geral e o interno DELE. Nao o do CRM.

    Se a consulta perder o filtro pela lente, o `Interno CRM` entra na lista.

    A lente de SUPERVISOR/OPERATOR e `{proprio time} + {raiz}`:
    ele alcanca o quadro geral porque a raiz esta na lente dele, e nao alcanca
    o CRM porque CRM nao esta.
    """
    c = await _setup(db)
    await db.commit()

    async with _client(db, c["ctx_sup"]) as cli:
        vistos = await _ids(cli)

    assert c["interno_seo"].id in vistos, (
        "o supervisor do SEO tem de ver o quadro interno do proprio subtime"
    )
    assert c["interno_crm"].id not in vistos, (
        "VAZAMENTO: o quadro interno do CRM apareceu para o supervisor do SEO"
    )


# ------------------------------------------------------------- 2. ADMIN ve tudo


async def test_admin_ve_todos_os_quadros_do_proprio_workspace(db) -> None:
    """ADMIN tem lente `None` (= todos os times) e ve os tres quadros ativos.

    ⚠️ TRES, e o numero e afirmacao: geral + interno SEO + interno CRM. O
    apagado NAO conta, e o do workspace B, que esta no banco, tambem nao: um
    vazamento de tenant daria 4.
    """
    c = await _setup(db)
    await db.commit()

    async with _client(db, c["ctx_adm"]) as cli:
        vistos = await _ids(cli)

    assert c["interno_seo"].id in vistos
    assert c["interno_crm"].id in vistos
    assert len(vistos) == 3, (
        f"ADMIN devia ver 3 quadros ativos do workspace A, viu {len(vistos)}"
    )


# --------------------------------------------------------- 3. quadro apagado


async def test_quadro_apagado_nao_aparece(db) -> None:
    """Quadro com `deleted_at` preenchido some da listagem, para todo mundo.

    ⚠️ Conferido com os DOIS contextos. Um `deleted_at IS NULL` esquecido pode
    morar no ramo do ADMIN e nao no do supervisor (ou o contrario), se a
    consulta tiver dois caminhos. Testar um so deixaria metade do defeito viva.
    """
    c = await _setup(db)
    await db.commit()

    async with _client(db, c["ctx_sup"]) as cli:
        vistos_sup = await _ids(cli)
    async with _client(db, c["ctx_adm"]) as cli:
        vistos_adm = await _ids(cli)

    assert c["apagado_seo"].id not in vistos_sup, (
        "quadro apagado apareceu para o supervisor"
    )
    assert c["apagado_seo"].id not in vistos_adm, (
        "quadro apagado apareceu para o ADMIN"
    )


# ------------------------------------------------- 4. a forma da resposta


async def test_a_resposta_traz_as_colunas_do_quadro(db) -> None:
    """Cada quadro vem com `id`, `name`, `team_id`, `is_default` e `colunas`.

    ⚠️ O quadro na tela e montado a partir DESTA lista: quadro sem coluna
    passaria nos testes de permissao acima e deixaria a tela sem dado.
    """
    c = await _setup(db)
    await db.commit()

    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.get("/api/v1/boards")
        assert r.status_code == 200, r.text
        corpo = r.json()

    geral = [q for q in corpo if q["is_default"]]
    assert len(geral) == 1, "o workspace A tem exatamente um quadro padrao"
    assert geral[0]["team_id"] == str(c["raiz"])

    for quadro in corpo:
        assert quadro["name"], f"quadro {quadro['id']} veio sem nome"
        assert len(quadro["colunas"]) == len(COLUNAS_PADRAO), (
            f"quadro {quadro['name']} veio com {len(quadro['colunas'])} "
            f"colunas; o arreio monta {len(COLUNAS_PADRAO)}"
        )

    # ⚠️ `is_status_bridge` E A METADE DA TRAVA DA PONTE QUE MORA NA COLUNA.
    # A outra metade e `is_default`, que ja esta na resposta do
    # QUADRO -- e o front so pode esconder o "x" quando as DUAS forem
    # verdadeiras. Se este campo sumir do contrato, a tela do Quadro geral
    # volta a oferecer oito exclusoes que derrubam o lote inteiro.
    for quadro in corpo:
        for coluna in quadro["colunas"]:
            assert isinstance(coluna["is_status_bridge"], bool)
            # ⚠️ E O VALOR NUNCA VAZA. Booleano, e nao o status.
            assert "legacy_status" not in coluna
