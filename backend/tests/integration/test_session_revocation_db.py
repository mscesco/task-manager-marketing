"""Revogacao de sessao, contra Postgres real, pela rota.

A revogacao vive em tres pontos independentes, nenhum deles no service:
    1. `get_tenant_context`        -- toda rota de negocio
    2. `get_user_allowing_pending` -- /auth/me, /auth/change-password, /auth/logout
    3. `AuthService.refresh`       -- nao passa por dependency nenhuma
Cada um tem um teste que fica vermelho sem ele.

O `cliente(db)` daqui sobrescreve so a sessao e a UoW (nao `get_tenant_context`)
e manda `Authorization: Bearer <token>` de verdade.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.db.models import User, Workspace
from app.modules.auth.infrastructure.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
)
from tests.integration import factories as f
from tests.integration.conftest import cliente

pytestmark = pytest.mark.integration

_SENHA = "senha-de-teste-1"
_NOVA = "senha-de-teste-2"


async def _pessoa(db, *, pendente: bool = False):
    """Workspace + time + usuario com senha real, pronto para logar."""
    ws_id = await f.make_workspace(db)
    ws = await db.get(Workspace, ws_id)
    team = await f.make_team(db, workspace_id=ws_id)
    uid = await f.make_user(db, workspace_id=ws_id)
    user = await db.get(User, uid)
    user.password_hash = hash_password(_SENHA)
    user.must_change_password = pendente
    await f.add_member(
        db, workspace_id=ws_id, user_id=uid, team_id=team, role="MANAGER"
    )
    await db.flush()
    return ws, team, user


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(c: AsyncClient, ws: Workspace, user: User) -> dict:
    r = await c.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": _SENHA,
            "workspace_slug": ws.slug,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------
# 1-2. Troca de senha derruba as outras sessoes
# ------------------------------------------------------------------
async def test_troca_de_senha_derruba_outra_sessao(db) -> None:
    """Dois browsers: troca a senha num, o outro cai no proximo clique."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        sessao_a = await _login(c, ws, user)
        sessao_b = await _login(c, ws, user)

        # A sessao B funciona antes da troca.
        antes = await c.get("/api/v1/auth/me", headers=_auth(sessao_b["access_token"]))
        assert antes.status_code == 200

        # A pessoa troca a senha na sessao A.
        troca = await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(sessao_a["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )
        assert troca.status_code == 200, troca.text

        # Confere a mensagem: 401 tambem e "usuario inativo".
        depois = await c.get("/api/v1/auth/me", headers=_auth(sessao_b["access_token"]))
        assert depois.status_code == 401
        assert "revogada" in depois.text.lower()


async def test_troca_de_senha_invalida_refresh_antigo(db) -> None:
    """O refresh guardado antes da troca de senha para de renovar."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        sessao = await _login(c, ws, user)

        ok = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert ok.status_code == 200

        await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(ok.json()["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )

        morto = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert morto.status_code == 401
        assert "revogada" in morto.text.lower()


async def test_par_emitido_no_change_password_ja_vale(db) -> None:
    """Depois da troca, o login com a senha nova funciona de primeira."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        sessao = await _login(c, ws, user)
        await c.post(
            "/api/v1/auth/change-password",
            headers=_auth(sessao["access_token"]),
            json={"current_password": _SENHA, "new_password": _NOVA},
        )
        novo = await c.post(
            "/api/v1/auth/login",
            json={
                "email": user.email,
                "password": _NOVA,
                "workspace_slug": ws.slug,
            },
        )
        assert novo.status_code == 200, novo.text
        me = await c.get(
            "/api/v1/auth/me", headers=_auth(novo.json()["access_token"])
        )
        assert me.status_code == 200


# ------------------------------------------------------------------
# 3-4. Reset pelo gestor
# ------------------------------------------------------------------
async def test_reset_pelo_gestor_derruba_sessao_do_alvo(db) -> None:
    """O reset de senha pelo gestor derruba a sessao do alvo."""
    from app.core.tenant import TeamNode
    from app.modules.users.application.member_service import MemberService
    from tests.integration.conftest import acting_as

    ws, team, alvo = await _pessoa(db)
    gestor = await f.make_user(db, workspace_id=ws.id, org_role="ADMIN")
    await db.commit()

    async with cliente(db) as c:
        sessao = await _login(c, ws, alvo)
        assert (
            await c.get("/api/v1/auth/me", headers=_auth(sessao["access_token"]))
        ).status_code == 200

        with acting_as(
            workspace_id=ws.id,
            user_id=gestor,
            team_tree=(TeamNode(team_id=team, parent_team_id=None),),
            org_role="ADMIN",
        ):
            await MemberService(db).reset_password(user_id=alvo.id)
        await db.commit()

        morta = await c.get(
            "/api/v1/auth/me", headers=_auth(sessao["access_token"])
        )
        assert morta.status_code == 401
        assert "revogada" in morta.text.lower()


async def test_reset_pelo_gestor_nao_derruba_terceiros(db) -> None:
    """O reset revoga so o alvo: a sessao de quem clicou sobrevive.

    O ator e GESTOR porque MANAGER nao reseta a senha de outro MANAGER.
    """
    from app.core.tenant import Membership, TeamNode
    from app.db.models.enums import OrgRole
    from app.modules.users.application.member_service import MemberService
    from tests.integration.conftest import acting_as

    ws, team, alvo = await _pessoa(db)
    outro_id = await f.make_user(db, workspace_id=ws.id)
    outro = await db.get(User, outro_id)
    outro.password_hash = hash_password(_SENHA)
    outro.org_role = OrgRole.GESTOR
    await f.add_member(
        db, workspace_id=ws.id, user_id=outro_id, team_id=team, role="MANAGER"
    )
    await db.commit()

    async with cliente(db) as c:
        sessao_outro = await _login(c, ws, outro)

        with acting_as(
            workspace_id=ws.id,
            user_id=outro_id,
            memberships=(Membership(team_id=team, role="MANAGER"),),
            team_tree=(TeamNode(team_id=team, parent_team_id=None),),
            org_role=OrgRole.GESTOR.value,
        ):
            await MemberService(db).reset_password(user_id=alvo.id)
        await db.commit()

        viva = await c.get(
            "/api/v1/auth/me", headers=_auth(sessao_outro["access_token"])
        )
        assert viva.status_code == 200


# ------------------------------------------------------------------
# 5-6. Logout
# ------------------------------------------------------------------
async def test_logout_invalida_refresh(db) -> None:
    """Logout invalida o refresh e o access da propria sessao."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        sessao = await _login(c, ws, user)

        saiu = await c.post(
            "/api/v1/auth/logout", headers=_auth(sessao["access_token"])
        )
        assert saiu.status_code == 204

        morto = await c.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": sessao["refresh_token"]},
        )
        assert morto.status_code == 401

        # O access da mesma sessao tambem morre.
        me = await c.get("/api/v1/auth/me", headers=_auth(sessao["access_token"]))
        assert me.status_code == 401


async def test_logout_derruba_todos_os_aparelhos(db) -> None:
    """Logout derruba todas as sessoes da pessoa, de proposito (nao e por `jti`)."""
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        compartilhada = await _login(c, ws, user)
        notebook = await _login(c, ws, user)

        await c.post("/api/v1/auth/logout", headers=_auth(notebook["access_token"]))

        esquecida = await c.get(
            "/api/v1/auth/me", headers=_auth(compartilhada["access_token"])
        )
        assert esquecida.status_code == 401


async def test_logout_de_um_nao_afeta_outro_usuario(db) -> None:
    """Logout de uma pessoa nao afeta a sessao de outra."""
    ws, team, user = await _pessoa(db)
    outro_id = await f.make_user(db, workspace_id=ws.id)
    outro = await db.get(User, outro_id)
    outro.password_hash = hash_password(_SENHA)
    await f.add_member(
        db, workspace_id=ws.id, user_id=outro_id, team_id=team, role="MANAGER"
    )
    await db.commit()

    async with cliente(db) as c:
        s_user = await _login(c, ws, user)
        s_outro = await _login(c, ws, outro)

        await c.post("/api/v1/auth/logout", headers=_auth(s_user["access_token"]))

        viva = await c.get("/api/v1/auth/me", headers=_auth(s_outro["access_token"]))
        assert viva.status_code == 200


async def test_logout_funciona_com_troca_de_senha_pendente(db) -> None:
    """Quem esta preso na troca obrigatoria de senha consegue sair.

    Se o logout usasse a dependency estrita, a pessoa com senha provisoria
    pendente levaria 409 e ficaria sem saida.
    """
    ws, _team, user = await _pessoa(db, pendente=True)
    await db.commit()
    async with cliente(db) as c:
        sessao = await _login(c, ws, user)
        # Confirma que o gate esta mesmo ativo nesta sessao.
        bloqueada = await c.get(
            "/api/v1/tasks", headers=_auth(sessao["access_token"])
        )
        assert bloqueada.status_code == 409

        saiu = await c.post(
            "/api/v1/auth/logout", headers=_auth(sessao["access_token"])
        )
        assert saiu.status_code == 204


# ------------------------------------------------------------------
# Claim `tv`
# ------------------------------------------------------------------
async def test_token_sem_claim_tv_e_recusado(db) -> None:
    """Token assinado mas sem o claim `tv` e invalido."""
    from datetime import UTC, datetime, timedelta

    import jwt

    from app.core.config import settings

    ws, _team, user = await _pessoa(db)
    await db.commit()

    agora = datetime.now(UTC)
    token_antigo = jwt.encode(
        {
            "sub": str(user.id),
            "ws": str(ws.id),
            "type": "access",
            "iat": agora,
            "exp": agora + timedelta(minutes=15),
            "jti": str(uuid.uuid4()),
            # sem "tv"
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    async with cliente(db) as c:
        r = await c.get("/api/v1/auth/me", headers=_auth(token_antigo))
        assert r.status_code == 401
        assert "invalido" in r.text.lower()


async def test_token_com_tv_defasado_e_recusado(db) -> None:
    """Token com `tv` menor que o da conta e recusado."""
    ws, _team, user = await _pessoa(db)
    await db.commit()

    user.token_version = 5
    await db.flush()
    await db.commit()

    defasado = create_access_token(
        user_id=user.id, workspace_id=ws.id, token_version=4
    )
    async with cliente(db) as c:
        r = await c.get("/api/v1/auth/me", headers=_auth(defasado))
        assert r.status_code == 401
        assert "revogada" in r.text.lower()


async def test_rota_de_negocio_recusa_token_revogado(db) -> None:
    """Ponto 1 (`get_tenant_context`): rota de negocio recusa token revogado.

    Os outros testes batem em `/auth/me`, que usa a dependency leniente; sem
    este, tirar a checagem de `get_tenant_context` ficaria verde.
    """
    ws, _team, user = await _pessoa(db)
    await db.commit()
    async with cliente(db) as c:
        sessao = await _login(c, ws, user)
        viva = await c.get("/api/v1/tasks", headers=_auth(sessao["access_token"]))
        assert viva.status_code == 200

        await c.post("/api/v1/auth/logout", headers=_auth(sessao["access_token"]))

        morta = await c.get("/api/v1/tasks", headers=_auth(sessao["access_token"]))
        assert morta.status_code == 401
        assert "revogada" in morta.text.lower()


async def test_refresh_com_tv_defasado_e_recusado(db) -> None:
    """Ponto 3 (`AuthService.refresh`), isolado: no teste de troca de senha a
    checagem da dependency poderia mascarar a falta desta."""
    ws, _team, user = await _pessoa(db)
    await db.commit()

    user.token_version = 3
    await db.flush()
    await db.commit()

    defasado = create_refresh_token(
        user_id=user.id, workspace_id=ws.id, token_version=2
    )
    async with cliente(db) as c:
        r = await c.post(
            "/api/v1/auth/refresh", json={"refresh_token": defasado}
        )
        assert r.status_code == 401
        assert "revogada" in r.text.lower()
