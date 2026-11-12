"""A lente de time na listagem de projetos, e o recorte por `?team_id=`.

Pela rota: o `?team_id=` e contrato de rota, e o 404 do `GET /projects/{id}`
e forma de resposta HTTP.

O mundo tem DUAS raizes no mesmo workspace (com uma so nada se distingue):
    Marketing (raiz) + subtime SEO
    Comercial (raiz)
    - `sup` : SUPERVISOR do SEO       -> lente = {SEO, Marketing}
    - `adm` : ADMIN de organizacao    -> lente = None (ve tudo)
    Projetos: um no Marketing, um no SEO, um no Comercial.

Sao dois recortes: a lente responde "posso ver?"; o `?team_id=` responde
"estou olhando qual time?". Para o ADMIN a lente e `None`, e so o `?team_id=`
tira o Comercial quando ele olha o Marketing.
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership, TenantContext
from app.modules.auth.domain.permissions import (
    permissions_for_actor,
    permissions_for_roles,
)
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Lente de Projeto")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    adm = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )

    p_marketing = await f.make_project(
        db,
        workspace_id=ws,
        created_by=adm,
        team_id=marketing,
        title="Campanha Q3",
    )
    p_seo = await f.make_project(
        db, workspace_id=ws, created_by=adm, team_id=seo, title="Palavras-chave"
    )
    p_comercial = await f.make_project(
        db, workspace_id=ws, created_by=adm, team_id=comercial, title="Metas"
    )

    arvore = (node(marketing), node(seo, marketing), node(comercial))

    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    # ⚠️ `org_role="ADMIN"` E O QUE FAZ A LENTE SER `None`. Desde a 0031 nao
    # existe mais "ADMIN de um time": quem administra e a ORGANIZACAO, sem
    # vinculo -- e as permissoes vem de `permissions_for_actor`, porque o mapa
    # plano so conhece papel de time e ignoraria o ADMIN.
    ctx_adm = TenantContext(
        workspace_id=ws,
        user_id=adm,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=arvore, org_role="ADMIN"
        ),
        memberships=(),
        team_tree=arvore,
        org_role="ADMIN",
    )

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "p_marketing": p_marketing,
        "p_seo": p_seo,
        "p_comercial": p_comercial,
        "ctx_sup": ctx_sup,
        "ctx_adm": ctx_adm,
    }


async def _titulos(cli, query: str = "") -> set[str]:
    r = await cli.get(f"/api/v1/projects{query}")
    assert r.status_code == 200, r.text
    return {p["title"] for p in r.json()["items"]}


# ------------------------------------------------- 1. a lente


async def test_supervisor_nao_ve_projeto_de_outra_raiz(db) -> None:
    """A lente da supervisora de SEO e {SEO, Marketing}: o projeto do Comercial
    (outra raiz) nao e dela para ver, nem pelo titulo."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        titulos = await _titulos(cli)

    assert "Metas" not in titulos
    # ⚠️ E as duas que ela DEVE ver continuam aparecendo. Sem esta metade, um
    # filtro que devolve lista vazia passaria o teste.
    assert titulos == {"Campanha Q3", "Palavras-chave"}


async def test_admin_de_organizacao_ve_as_duas_raizes(db) -> None:
    """A lente `None` do admin de organizacao continua sendo `None`: ele
    alcanca o Comercial de verdade."""
    m = await _setup(db)
    async with cliente(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli)

    assert titulos == {"Campanha Q3", "Palavras-chave", "Metas"}


# ------------------------------------------------- 2. o recorte por time


async def test_recorte_pela_raiz_traz_o_projeto_do_subtime(db) -> None:
    """`?team_id=<raiz>` casa a raiz E os descendentes, e tira a outra raiz
    mesmo para o admin. Igualdade pura esconderia o projeto do subtime."""
    m = await _setup(db)
    async with cliente(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['marketing']}")

    assert titulos == {"Campanha Q3", "Palavras-chave"}


async def test_recorte_pelo_subtime_traz_so_o_dele(db) -> None:
    """Pedir o SUBTIME nao sobe para a raiz -- descendentes, nao ancestrais."""
    m = await _setup(db)
    async with cliente(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['seo']}")

    assert titulos == {"Palavras-chave"}


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """O parametro estreita, nunca alarga: a supervisora de SEO pede o
    Comercial e recebe vazio. Quem garante e o AND entre lente e recorte."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['comercial']}")

    assert titulos == set()


# ------------------------------------------------- 3. a porta do id


async def test_projeto_de_outra_raiz_responde_404_no_get(db) -> None:
    """Esconder da lista e entregar pelo id protege contra navegar, nao contra pedir.

    ⚠️ 404 e nao 403: responder 403 confirmaria que o id existe.
    """
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/projects/{m['p_comercial']}")

    assert r.status_code == 404, r.text


async def test_get_do_proprio_projeto_segue_funcionando(db) -> None:
    """A trava do `get` nao pode fechar a porta de quem tem a chave."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/projects/{m['p_seo']}")

    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Palavras-chave"
