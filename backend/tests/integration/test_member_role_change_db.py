"""Spec 015, Fatia 2 -- trocar papel de membro existente (matriz C2 + C3).

Matriz (C2):
    ADMIN   -> qualquer alvo, qualquer papel.
    MANAGER -> so alvo SUPERVISOR/OPERATOR e so atribui SUPERVISOR/OPERATOR.
Anti-lockout (C3): ninguem altera o proprio papel.

Cobre: ADMIN promove p/ qualquer (inclui ADMIN), MANAGER OPERATOR->SUPERVISOR,
MANAGER bloqueado ao atribuir MANAGER/ADMIN, MANAGER bloqueado ao mexer em
alvo MANAGER/ADMIN, auto-alteracao bloqueada, vinculo inexistente -> 404.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    EntityNotFoundError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _papel_atual(db, *, user_id, team_id) -> UserTeamRole:
    ut = await MemberService(db)._users.get_team_membership(
        user_id=user_id, team_id=team_id
    )
    assert ut is not None
    return ut.role


async def test_admin_troca_para_qualquer_papel(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        # ADMIN pode ate promover a ADMIN.
        await MemberService(db).change_member_role(
            user_id=alvo, team_id=raiz, new_role=UserTeamRole.ADMIN
        )
        assert await _papel_atual(db, user_id=alvo, team_id=raiz) == UserTeamRole.ADMIN


async def test_manager_troca_operator_para_supervisor(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        await MemberService(db).change_member_role(
            user_id=alvo, team_id=raiz, new_role=UserTeamRole.SUPERVISOR
        )
        assert await _papel_atual(db, user_id=alvo, team_id=raiz) == UserTeamRole.SUPERVISOR


async def test_manager_nao_promove_para_manager(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.MANAGER
            )


async def test_manager_nao_mexe_em_alvo_manager(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    outro_mgr = await f.make_user(db, workspace_id=ws, email="mgr2@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=outro_mgr, team_id=raiz, role="MANAGER")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).change_member_role(
                user_id=outro_mgr, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_nao_altera_proprio_papel(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=admin, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_vinculo_inexistente_404(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    # alvo existe mas NAO tem vinculo com a raiz
    alvo = await f.make_user(db, workspace_id=ws, email="solto@t.dev")

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.SUPERVISOR
            )
