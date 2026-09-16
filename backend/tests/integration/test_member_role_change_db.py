"""Spec 015, Fatia 2 -- trocar papel de membro existente (matriz C2 + C3).

Matriz (C2), como ficou na Spec 051 (fatia C, decisao 6 de 16/09):
    ADMIN   -> qualquer alvo, qualquer papel.
    GESTOR  -> alvo ate MANAGER; atribui ate MANAGER.
    MANAGER -> so alvo SUPERVISOR/OPERATOR; atribui ate MANAGER ("so promove").
Anti-lockout (C3): ninguem altera o proprio papel.

Cobre: ADMIN promove p/ qualquer papel de time, MANAGER OPERATOR->SUPERVISOR,
MANAGER promove a MANAGER e nao rebaixa o par, MANAGER bloqueado ao atribuir
ADMIN, MANAGER bloqueado ao mexer em alvo MANAGER/ADMIN, auto-alteracao
bloqueada, vinculo inexistente -> 404.

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


async def test_admin_troca_para_qualquer_papel_de_time(db) -> None:
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
        # ⭐ Spec 045, fatia D: ADMIN saiu do nivel de TIME. Ate aqui esta
        # linha dizia "ADMIN pode ate promover a ADMIN" e o teste se chamava
        # `..._para_qualquer_papel` -- hoje "qualquer papel" nao inclui ADMIN
        # em lugar nenhum, porque nao ha time que o aceite.
        # Quem promove um administrador usa `change_organization_role`.
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.ADMIN
            )
        # E o papel de raiz que ele PODE dar continua funcionando.
        await MemberService(db).change_member_role(
            user_id=alvo, team_id=raiz, new_role=UserTeamRole.MANAGER
        )
        assert (
            await _papel_atual(db, user_id=alvo, team_id=raiz)
            == UserTeamRole.MANAGER
        )


async def test_manager_troca_operator_para_supervisor(db) -> None:
    """⚠️ A PROMOCAO ACONTECE NO SUBTIME, e nao na raiz como ate a Spec 045.

    O teste media a matriz de quem-promove-quem (Spec 016): um MANAGER pode
    elevar um operador a supervisor. Isso continua valendo -- so que o unico
    lugar onde SUPERVISOR existe passou a ser o subtime (fatia D), entao o
    cenario mudou de lugar sem mudar de assunto.
    """
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
    """⚠️⚠️ MUDOU DE LADO NA SPEC 051 (fatia C) -- e revoga a C2 da Spec 015.

    Ate 16/09 este teste se chamava `test_manager_nao_promove_para_manager` e
    afirmava a recusa: MANAGER so dava SUPERVISOR/OPERATOR, para nao "criar
    par". A Camila decidiu o contrario (decisao 6): *"gerente pode tornar
    alguem de dentro da sua arvore gerente"* -- e, no mesmo dia, que ele SO
    PROMOVE: rebaixar o gerente recem-criado continua com gestor e admin.

    As duas metades ficam aqui, porque uma sem a outra e a regra errada: so a
    primeira deixaria dois gerentes se rebaixando; so a segunda e a C2 antiga.
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
