"""Integracao da Entrega 7 -- ciclo de vida de senha contra Postgres real.

Marcado `integration`: pulado sem TEST_DATABASE_URL. Roda no harness da
Entrega 5 (savepoint+rollback por teste). Exerce os services diretamente,
como as demais suites de integracao, cobrindo:
    - cadastro gera provisoria + pendencia + expiracao (ADR 0019);
    - login com provisoria valida funciona; expirada -> AuthenticationError;
    - change_password destrava (zera flag e expiracao) e valida entradas;
    - reset_password re-arma a pendencia com nova provisoria;
    - admin do provisioning NAO nasce com pendencia.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import User, Workspace
from app.modules.auth.application.service import AuthService
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)
from app.shared.exceptions.base import AuthenticationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

_WS_SLUG_HOLDER: dict[str, str] = {}


async def _ws_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    return ws, team, user


async def _create_member(db, ws, team, admin):
    """Cria um membro via service, no contexto do admin do workspace."""
    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        return await MemberService(db).create_member(
            CreateMemberCommand(
                name="Novato",
                email=f"novato-{team.hex[:6]}@fecaf.com.br",
                team_id=team,
                role=UserTeamRole.OPERATOR,
            )
        )


# --------------------------------------------------------
# Cadastro
# --------------------------------------------------------
async def test_create_member_sets_pending_and_expiry(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)

    assert provisioned.temporary_password  # segredo presente
    assert provisioned.user.must_change_password is True
    assert provisioned.user.password_expires_at is not None
    # expira no futuro (TTL configurado)
    assert provisioned.user.password_expires_at > datetime.now(UTC)


# --------------------------------------------------------
# Login com provisoria
# --------------------------------------------------------
async def test_login_with_valid_temp_password_works(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)
    ws_row = await db.get(Workspace, ws)

    tokens = await AuthService(db).login(
        email=provisioned.user.email,
        password=provisioned.temporary_password,
        workspace_slug=ws_row.slug,
    )
    assert tokens.access_token and tokens.refresh_token


async def test_login_with_expired_temp_password_is_rejected(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)
    ws_row = await db.get(Workspace, ws)

    # Force a expiracao para o passado.
    provisioned.user.password_expires_at = datetime.now(UTC) - timedelta(hours=1)
    await db.flush()

    with pytest.raises(AuthenticationError):
        await AuthService(db).login(
            email=provisioned.user.email,
            password=provisioned.temporary_password,
            workspace_slug=ws_row.slug,
        )


# --------------------------------------------------------
# Troca de senha (destrava o gate)
# --------------------------------------------------------
async def test_change_password_clears_pending_and_expiry(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)

    await AuthService(db).change_password(
        user_id=provisioned.user.id,
        current_password=provisioned.temporary_password,
        new_password="novaSenhaForte123",
    )
    refreshed = await db.get(User, provisioned.user.id)
    assert refreshed.must_change_password is False
    assert refreshed.password_expires_at is None


async def test_change_password_rejects_same_password(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)

    with pytest.raises(ValidationError):
        await AuthService(db).change_password(
            user_id=provisioned.user.id,
            current_password=provisioned.temporary_password,
            new_password=provisioned.temporary_password,
        )


async def test_change_password_rejects_wrong_current(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)

    with pytest.raises(AuthenticationError):
        await AuthService(db).change_password(
            user_id=provisioned.user.id,
            current_password="senha-errada-qualquer",
            new_password="novaSenhaForte123",
        )


# --------------------------------------------------------
# Reset administrativo
# --------------------------------------------------------
async def test_reset_password_rearms_pending_with_new_secret(db) -> None:
    ws, team, admin = await _ws_admin(db)
    provisioned = await _create_member(db, ws, team, admin)

    # Usuario ja trocou a senha -> destravado.
    await AuthService(db).change_password(
        user_id=provisioned.user.id,
        current_password=provisioned.temporary_password,
        new_password="novaSenhaForte123",
    )

    # Admin reseta.
    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    ):
        reset = await MemberService(db).reset_password(
            user_id=provisioned.user.id
        )

    assert reset.user.must_change_password is True
    assert reset.user.password_expires_at is not None
    assert reset.temporary_password != provisioned.temporary_password


# --------------------------------------------------------
# Provisioning do admin nao nasce travado
# --------------------------------------------------------
async def test_admin_from_factory_not_pending(db) -> None:
    ws, team, admin = await _ws_admin(db)
    admin_row = await db.get(User, admin)
    assert admin_row.must_change_password is False


# --------------------------------------------------------
# Equalizacao de tempo no login (anti-enumeracao) -- achado da auditoria
# --------------------------------------------------------
async def test_login_inexistente_roda_bcrypt_equalizando_tempo(db, monkeypatch) -> None:
    """Login com e-mail/workspace inexistente ainda roda bcrypt (equaliza tempo).

    Sem isso, o caminho "nao existe" retornava sem rodar bcrypt (~100ms a menos
    que o de senha errada) e a diferenca de tempo denunciava quais contas/
    workspaces existem (enumeracao). Timing em si nao e testavel de forma
    estavel; aqui provamos o MECANISMO: verify_password e de fato invocado nos
    dois caminhos de falha por inexistencia.
    """
    ws, team, admin = await _ws_admin(db)
    ws_row = await db.get(Workspace, ws)

    import app.modules.auth.application.service as svc

    chamadas = {"n": 0}

    def _spy(_plain: str, _hashed: str) -> bool:
        chamadas["n"] += 1
        return False

    monkeypatch.setattr(svc, "verify_password", _spy)

    # (a) e-mail inexistente, workspace valido -> roda bcrypt uma vez.
    chamadas["n"] = 0
    with pytest.raises(AuthenticationError):
        await AuthService(db).login(
            email="nao-existe@fecaf.com.br",
            password="qualquer-coisa",
            workspace_slug=ws_row.slug,
        )
    assert chamadas["n"] == 1

    # (b) workspace inexistente -> roda bcrypt uma vez.
    chamadas["n"] = 0
    with pytest.raises(AuthenticationError):
        await AuthService(db).login(
            email="qualquer@fecaf.com.br",
            password="qualquer-coisa",
            workspace_slug="workspace-que-nao-existe",
        )
    assert chamadas["n"] == 1
