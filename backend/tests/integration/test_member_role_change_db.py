"""Trocar papel de membro existente (`change_member_role`).

Quem troca o papel de quem:
    ADMIN   -> qualquer alvo, qualquer papel.
    GESTOR  -> alvo ate MANAGER; atribui ate MANAGER.
    MANAGER -> so alvo SUPERVISOR/OPERATOR; atribui ate MANAGER ("so promove").
Anti-lockout: ninguem altera o proprio papel.

Cobre: ADMIN (de organizacao) promove p/ papel de time, MANAGER OPERATOR->SUPERVISOR,
MANAGER promove a MANAGER e nao rebaixa o par, MANAGER bloqueado ao atribuir
ADMIN, auto-alteracao bloqueada, vinculo inexistente -> 404.
"""

from __future__ import annotations

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


async def test_admin_troca_para_qualquer_papel_de_time(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(workspace_id=ws, user_id=admin, org_role="ADMIN"):
        # ADMIN nao existe no enum de time: "qualquer papel de time" nao o
        # inclui. Quem promove um administrador usa `change_organization_role`.
        await MemberService(db).change_member_role(
            user_id=alvo, team_id=raiz, new_role=UserTeamRole.MANAGER
        )
        assert (
            await _papel_atual(db, user_id=alvo, team_id=raiz)
            == UserTeamRole.MANAGER
        )


async def test_manager_troca_operator_para_supervisor(db) -> None:
    """SUPERVISOR so existe em subtime: e la que o MANAGER da raiz promove."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        await MemberService(db).change_member_role(
            user_id=alvo, team_id=seo, new_role=UserTeamRole.SUPERVISOR
        )
        assert await _papel_atual(db, user_id=alvo, team_id=seo) == UserTeamRole.SUPERVISOR


async def test_manager_PROMOVE_a_manager_mas_nao_rebaixa_o_par(db) -> None:
    """Gerente pode tornar gerente alguem da sua arvore, mas SO PROMOVE:
    rebaixar o gerente recem-criado fica com gestor e admin.

    As duas metades ficam juntas: so a primeira deixaria dois gerentes se
    rebaixando; so a segunda proibiria a promocao.
    """
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
            user_id=alvo, team_id=raiz, new_role=UserTeamRole.MANAGER
        )
        assert (
            await _papel_atual(db, user_id=alvo, team_id=raiz) == UserTeamRole.MANAGER
        )

        # O par que ele acabou de criar ja nao e dele para rebaixar.
        with pytest.raises(AuthorizationError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_nao_altera_proprio_papel(db) -> None:
    """⚠️ O ator e um MANAGER, e nao o ADMIN de organizacao: quem manda pela
    organizacao e a excecao do anti-lockout (`_autoridade_vem_da_organizacao`)."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=mgr, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_vinculo_inexistente_404(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    # alvo existe mas NAO tem vinculo com a raiz
    alvo = await f.make_user(db, workspace_id=ws, email="solto@t.dev")

    with acting_as(workspace_id=ws, user_id=admin, org_role="ADMIN"):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.SUPERVISOR
            )
