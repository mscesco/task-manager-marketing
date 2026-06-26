"""Spec 016 -- adicionar membro existente a um time, agora pela matriz.

assign_to_team passa a chamar _assert_actor_can_assign (Spec 015): ADMIN
atribui qualquer papel; MANAGER so SUPERVISOR/OPERATOR. Adicionar e aditivo
(sem self-guard). Mantem 409 (ja no time) e 422 (2o subtime).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    ConflictError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def test_admin_adiciona_qualquer_papel(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.ADMIN
        )
        assert ut.team_id == seo
        assert ut.role == UserTeamRole.ADMIN


async def test_manager_adiciona_supervisor(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR


async def test_manager_nao_adiciona_admin(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.ADMIN
            )
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.MANAGER
            )


async def test_adicionar_no_time_que_ja_esta_409(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(ConflictError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=raiz, role=UserTeamRole.OPERATOR
            )


async def test_adicionar_segundo_subtime_422(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="design")
    b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(ValidationError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=b, role=UserTeamRole.OPERATOR
            )
