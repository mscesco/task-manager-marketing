"""Categorias e tags de projeto: o catalogo do time raiz e o vinculo com o projeto.

Mundo: Marketing (raiz) + subtime SEO; Comercial (outra raiz).
    - `ger`: MANAGER do Marketing (edita projeto la)
    - `op` : OPERATOR do SEO (ve o Marketing; nao edita projeto)
    - `adm`: ADMIN de organizacao
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership, TenantContext
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Rotulos")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=marketing, slug="seo")
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    arvore = (node(marketing), node(seo, marketing), node(comercial))

    def ctx(user, memberships, org_role=None):
        return TenantContext(
            workspace_id=ws,
            user_id=user,
            roles=frozenset({m.role for m in memberships} | ({org_role} if org_role else set())),
            permissions=permissions_for_actor(
                memberships=memberships, tree=arvore, org_role=org_role
            ),
            memberships=memberships,
            team_tree=arvore,
            org_role=org_role,
        )

    ger = await f.make_user(db, workspace_id=ws, email="ger@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=ger, team_id=marketing, role="MANAGER")
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR")
    adm = await f.make_user(db, workspace_id=ws, email="adm@t.dev", org_role="ADMIN")
    projeto = await f.make_project(
        db, workspace_id=ws, created_by=ger, team_id=marketing, title="Campanha"
    )
    return {
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "projeto": projeto,
        "ger": ctx(ger, (Membership(team_id=marketing, role="MANAGER"),)),
        "op": ctx(op, (Membership(team_id=seo, role="OPERATOR"),)),
        "adm": ctx(adm, (), "ADMIN"),
    }


async def _criar(cli, tipo, team_id, name, color="blue"):
    r = await cli.post(
        f"/api/v1/project-{tipo}", json={"team_id": str(team_id), "name": name, "color": color}
    )
    return r


# ------------------------------------------------- catalogo


async def test_criar_pelo_subtime_grava_na_raiz_e_lista_por_ela(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        r = await _criar(cli, "categories", m["seo"], "  Eventos ")
        assert r.status_code == 201, r.text
        assert r.json()["team_id"] == str(m["marketing"])
        assert r.json()["name"] == "Eventos"

        nomes = [c["name"] for c in (await cli.get(
            f"/api/v1/project-categories?team_id={m['seo']}"
        )).json()]
    assert nomes == ["Eventos"]

    async with cliente(db, m["adm"]) as cli:
        outra = (await cli.get(f"/api/v1/project-categories?team_id={m['comercial']}")).json()
    assert outra == []


async def test_nome_repetido_sem_diferenciar_maiuscula_e_409(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        assert (await _criar(cli, "tags", m["marketing"], "Evento")).status_code == 201
        r = await _criar(cli, "tags", m["marketing"], "evento")
    assert r.status_code == 409, r.text


async def test_mesmo_nome_em_outra_raiz_pode(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["adm"]) as cli:
        assert (await _criar(cli, "tags", m["marketing"], "Evento")).status_code == 201
        assert (await _criar(cli, "tags", m["comercial"], "Evento")).status_code == 201


async def test_cor_fora_da_paleta_e_422(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        r = await _criar(cli, "tags", m["marketing"], "Evento", color="#ff0000")
    assert r.status_code == 422, r.text


async def test_quem_nao_edita_projeto_ve_mas_nao_cria(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        assert (await _criar(cli, "tags", m["marketing"], "Evento")).status_code == 201
    async with cliente(db, m["op"]) as cli:
        lista = (await cli.get(f"/api/v1/project-tags?team_id={m['seo']}")).json()
        r = await _criar(cli, "tags", m["seo"], "Outra")
    assert [t["name"] for t in lista] == ["Evento"]
    assert r.status_code == 403, r.text


async def test_rotulo_de_outra_raiz_e_404_ao_editar(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["adm"]) as cli:
        tag = (await _criar(cli, "tags", m["comercial"], "Metas")).json()
    async with cliente(db, m["ger"]) as cli:
        r = await cli.patch(f"/api/v1/project-tags/{tag['id']}", json={"name": "X"})
    assert r.status_code == 404, r.text


# ------------------------------------------------- vinculo com o projeto


async def test_projeto_aponta_categoria_e_tags_e_patch_respeita_ausente(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        cat = (await _criar(cli, "categories", m["marketing"], "Eventos")).json()
        t1 = (await _criar(cli, "tags", m["marketing"], "Zeta")).json()
        t2 = (await _criar(cli, "tags", m["marketing"], "Alfa")).json()
        url = f"/api/v1/projects/{m['projeto']}"

        r = await cli.patch(
            url, json={"category_id": cat["id"], "tag_ids": [t1["id"], t2["id"], t1["id"]]}
        )
        assert r.status_code == 200, r.text
        assert r.json()["category"]["name"] == "Eventos"
        assert [t["name"] for t in r.json()["tags"]] == ["Alfa", "Zeta"]

        # Ausente nao mexe.
        r = await cli.patch(url, json={"title": "Campanha 2"})
        assert r.json()["category"]["id"] == cat["id"]
        assert len(r.json()["tags"]) == 2

        lista = (await cli.get(f"/api/v1/projects?team_id={m['marketing']}")).json()["items"]
        assert lista[0]["category"]["name"] == "Eventos"

        # `null` e `[]` tiram.
        r = await cli.patch(url, json={"category_id": None, "tag_ids": []})
        assert r.json()["category"] is None
        assert r.json()["tags"] == []


async def test_criar_projeto_ja_com_categoria_e_tags(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        cat = (await _criar(cli, "categories", m["marketing"], "Eventos")).json()
        tag = (await _criar(cli, "tags", m["marketing"], "Feira")).json()
        r = await cli.post(
            "/api/v1/projects",
            json={
                "title": "Novo",
                "team_id": str(m["marketing"]),
                "category_id": cat["id"],
                "tag_ids": [tag["id"]],
            },
        )
    assert r.status_code == 201, r.text
    assert r.json()["category"]["id"] == cat["id"]
    assert [t["id"] for t in r.json()["tags"]] == [tag["id"]]


async def test_tag_de_outra_raiz_e_422_no_projeto(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["adm"]) as cli:
        tag = (await _criar(cli, "tags", m["comercial"], "Metas")).json()
        r = await cli.patch(f"/api/v1/projects/{m['projeto']}", json={"tag_ids": [tag["id"]]})
    assert r.status_code == 422, r.text


async def test_apagar_categoria_e_tag_solta_o_projeto(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        cat = (await _criar(cli, "categories", m["marketing"], "Eventos")).json()
        tag = (await _criar(cli, "tags", m["marketing"], "Feira")).json()
        url = f"/api/v1/projects/{m['projeto']}"
        await cli.patch(url, json={"category_id": cat["id"], "tag_ids": [tag["id"]]})

        assert (await cli.delete(f"/api/v1/project-categories/{cat['id']}")).status_code == 204
        assert (await cli.delete(f"/api/v1/project-tags/{tag['id']}")).status_code == 204
        projeto = (await cli.get(url)).json()
    assert projeto["category"] is None
    assert projeto["tags"] == []
