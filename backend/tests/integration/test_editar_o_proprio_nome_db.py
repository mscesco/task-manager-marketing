"""Spec 051, fatia E -- cada pessoa edita o PROPRIO nome (decisao 8).

*"liberar somente para proprio, eu posso editar meu proprio nome"* (Camila,
16/09). O que este arquivo prende:

    1. trocar o nome grava o nome aparado;
    2. nome so de espaco e 422 -- e nada muda;
    3. ⭐ nao ha como mirar OUTRA pessoa: o corpo nao tem alvo, e um `user_id`
       mandado junto e ignorado -- o alvo e sempre quem esta no token;
    4. o nome nao e credencial: as sessoes nao caem (`token_version` igual).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.db.models import User
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_current_user
from app.modules.auth.application.service import AuthService
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f

pytestmark = pytest.mark.integration


def _client(db, user: User) -> AsyncClient:
    """App real, com a sessao do teste e o usuario do token injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _user():
        return user

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_troca_o_proprio_nome_aparado(db) -> None:
    ws = await f.make_workspace(db)
    uid = await f.make_user(db, workspace_id=ws, email="ana@t.dev")
    user = await db.get(User, uid)
    versao = user.token_version

    async with _client(db, user) as cli:
        r = await cli.patch("/api/v1/auth/me", json={"name": "  Ana Souza  "})

    assert r.status_code == 200, r.text
    assert r.json() == {"name": "Ana Souza"}
    await db.refresh(user)
    assert user.name == "Ana Souza"
    # O nome nao e credencial: ninguem cai por trocar um acento.
    assert user.token_version == versao


async def test_nome_so_de_espaco_e_recusado(db) -> None:
    ws = await f.make_workspace(db)
    uid = await f.make_user(db, workspace_id=ws, email="ana@t.dev")
    user = await db.get(User, uid)
    antes = user.name

    with pytest.raises(ValidationError):
        await AuthService(db).rename_self(user_id=uid, name="   ")
    await db.refresh(user)
    assert user.name == antes


async def test_nao_ha_como_mirar_outra_pessoa(db) -> None:
    """⭐ A regra da decisao 8 inteira.

    Um `user_id` de outra pessoa mandado no corpo nao muda nada nela: o schema
    nao tem o campo, e o alvo sai do token. Sem esta prova, "so o proprio"
    seria so um nome de rota.
    """
    ws = await f.make_workspace(db)
    eu_id = await f.make_user(db, workspace_id=ws, email="eu@t.dev")
    outra_id = await f.make_user(db, workspace_id=ws, email="outra@t.dev")
    eu = await db.get(User, eu_id)
    outra = await db.get(User, outra_id)
    nome_da_outra = outra.name

    async with _client(db, eu) as cli:
        r = await cli.patch(
            "/api/v1/auth/me",
            json={"name": "Trocado", "user_id": str(outra_id)},
        )

    assert r.status_code == 200, r.text
    await db.refresh(outra)
    await db.refresh(eu)
    assert outra.name == nome_da_outra
    assert eu.name == "Trocado"
