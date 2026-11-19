"""Chaves de API (Spec 065): age como a dona, pelas mesmas conferências do login.

Mundo: Marketing (raiz); `ger` é MANAGER dele. As chaves autenticam de verdade
(`cliente(db)` sem `ctx`); criar e revogar usa o login da tela (`ctx`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.tenant import Membership, TenantContext
from app.db.models import ApiKey, User
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.developer.application import api_keys
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Chaves")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    arvore = (node(marketing),)

    async def pessoa(email):
        uid = await f.make_user(db, workspace_id=ws, email=email)
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=marketing, role="MANAGER")
        ms = (Membership(team_id=marketing, role="MANAGER"),)
        return TenantContext(
            workspace_id=ws,
            user_id=uid,
            roles=frozenset({"MANAGER"}),
            permissions=permissions_for_actor(memberships=ms, tree=arvore, org_role=None),
            memberships=ms,
            team_tree=arvore,
        )

    ger, outra = await pessoa("ger@t.dev"), await pessoa("o@t.dev")
    return {"marketing": marketing, "ger": ger, "outra": outra}


async def _chave(db, ctx, *, read_only=False, days=90):
    _, chave = await api_keys.criar(db, ctx, name="Teste", read_only=read_only, days=days)
    return chave


def _h(chave):
    return {"Authorization": f"Bearer {chave}"}


async def _categoria(cli, chave, team, nome="Eventos"):
    return await cli.post(
        "/api/v1/project-categories",
        json={"team_id": str(team), "name": nome},
        headers=_h(chave),
    )


async def test_criar_mostra_a_chave_uma_vez_e_a_lista_nao(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        r = await cli.post("/api/v1/me/api-keys", json={"name": " Looker ", "read_only": True})
        assert r.status_code == 201, r.text
        corpo = r.json()
        assert corpo["key"].startswith("tm_") and corpo["prefix"] == corpo["key"][:10]
        assert corpo["name"] == "Looker" and corpo["read_only"] is True
        # Padrão: 90 dias.
        expira = datetime.fromisoformat(corpo["expires_at"])
        assert timedelta(days=89) < expira - datetime.now(UTC) <= timedelta(days=90)

        lista = (await cli.get("/api/v1/me/api-keys")).json()
    assert [k["id"] for k in lista] == [corpo["id"]]
    assert "key" not in lista[0]
    guardada = await db.scalar(select(ApiKey).where(ApiKey.id == corpo["id"]))
    assert guardada.key_hash == api_keys.hash_da(corpo["key"])


async def test_sem_validade(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        r = await cli.post("/api/v1/me/api-keys", json={"name": "Eterna", "days": None})
    assert r.status_code == 201 and r.json()["expires_at"] is None


async def test_a_chave_age_como_a_dona_e_marca_o_uso(db) -> None:
    m = await _setup(db)
    chave = await _chave(db, m["ger"])
    async with cliente(db) as cli:
        assert (await cli.get("/api/v1/me/assignments", headers=_h(chave))).status_code == 200
        r = await _categoria(cli, chave, m["marketing"])
    assert r.status_code == 201, r.text
    usada = await db.scalar(select(ApiKey).where(ApiKey.key_hash == api_keys.hash_da(chave)))
    assert usada.last_used_at is not None


async def test_so_leitura_recusa_escrita(db) -> None:
    m = await _setup(db)
    chave = await _chave(db, m["ger"], read_only=True)
    async with cliente(db) as cli:
        assert (await cli.get("/api/v1/me/assignments", headers=_h(chave))).status_code == 200
        r = await _categoria(cli, chave, m["marketing"])
    assert r.status_code == 403
    assert "só de leitura" in r.text


async def test_pessoa_desativada_perde_a_chave_e_reativada_volta(db) -> None:
    m = await _setup(db)
    chave = await _chave(db, m["ger"])
    dona = m["ger"].user_id
    async with cliente(db) as cli:
        await db.execute(update(User).where(User.id == dona).values(is_active=False))
        assert (await cli.get("/api/v1/me/assignments", headers=_h(chave))).status_code == 401
        await db.execute(update(User).where(User.id == dona).values(is_active=True))
        assert (await cli.get("/api/v1/me/assignments", headers=_h(chave))).status_code == 200


async def test_revogada_expirada_ou_inventada_e_401(db) -> None:
    m = await _setup(db)
    revogada = await _chave(db, m["ger"])
    vencida = await _chave(db, m["ger"])
    await db.execute(
        update(ApiKey)
        .where(ApiKey.key_hash == api_keys.hash_da(vencida))
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    alvo = await db.scalar(select(ApiKey.id).where(ApiKey.key_hash == api_keys.hash_da(revogada)))
    async with cliente(db, m["ger"]) as cli:
        assert (await cli.delete(f"/api/v1/me/api-keys/{alvo}")).status_code == 204
    async with cliente(db) as cli:
        for chave in (revogada, vencida, "tm_inventada"):
            assert (await cli.get("/api/v1/me/assignments", headers=_h(chave))).status_code == 401


async def test_chave_nao_mexe_em_chave(db) -> None:
    m = await _setup(db)
    chave = await _chave(db, m["ger"])
    async with cliente(db) as cli:
        assert (await cli.get("/api/v1/me/api-keys", headers=_h(chave))).status_code == 403
        r = await cli.post("/api/v1/me/api-keys", json={"name": "Outra"}, headers=_h(chave))
    assert r.status_code == 403


async def test_nao_revoga_a_chave_de_outra_pessoa(db) -> None:
    m = await _setup(db)
    await _chave(db, m["outra"])
    alheia = await db.scalar(select(ApiKey.id).where(ApiKey.user_id == m["outra"].user_id))
    async with cliente(db, m["ger"]) as cli:
        assert (await cli.delete(f"/api/v1/me/api-keys/{alheia}")).status_code == 404


async def test_ate_dez_ativas(db) -> None:
    m = await _setup(db)
    for _ in range(api_keys.MAX_ATIVAS):
        await _chave(db, m["ger"])
    async with cliente(db, m["ger"]) as cli:
        r = await cli.post("/api/v1/me/api-keys", json={"name": "Décima primeira"})
    assert r.status_code in (409, 422), r.text
    assert "10 chaves" in r.text


async def test_referencia_so_para_quem_entrou_e_sem_rotas_de_sistema(db) -> None:
    m = await _setup(db)
    chave = await _chave(db, m["ger"], read_only=True)
    async with cliente(db) as cli:
        assert (await cli.get("/api/v1/dev/openapi")).status_code == 401
        r = await cli.get("/api/v1/dev/openapi", headers=_h(chave))
    assert r.status_code == 200
    caminhos = r.json()["paths"]
    assert "/api/v1/tasks" in caminhos
    assert not any(p.startswith("/api/v1/system") for p in caminhos)
