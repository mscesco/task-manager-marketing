"""Spec 015, Fatia 4 -- remover (B3) vinculo de membro.

Regras:
    C1 -- ao remover, a pessoa perde acesso; tarefas ficam (nao testavel
          aqui, pois e dormente: tudo roda na raiz).
    C2 -- matriz: ADMIN qualquer; MANAGER so SUPERVISOR/OPERATOR.
    C3 -- ninguem remove a si mesmo.

⚠️ O BLOCO B2 (MOVER DE SUBTIME) SAIU EM 17/09/2026, com a rota
`POST /members/{id}/move-subteam` e `MemberService.move_member_subteam`, que
nao tinham chamador na tela. O nome do arquivo ficou para nao perder o
historico do git.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    EntityNotFoundError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _membership(db, *, user_id, team_id):
    return await MemberService(db)._users.get_team_membership(
        user_id=user_id, team_id=team_id
    )


# --------------------------------------------------------
# B3 -- remover vinculo
# --------------------------------------------------------
async def test_admin_remove_vinculo(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    # alvo em raiz + subtime -> remover o subtime e seguro (sobra a raiz).
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        await MemberService(db).remove_member_from_team(user_id=alvo, team_id=seo)
        assert await _membership(db, user_id=alvo, team_id=seo) is None
        # ainda tem o vinculo da raiz (nao virou orfao).
        assert await _membership(db, user_id=alvo, team_id=raiz) is not None


async def test_nao_remove_ultimo_vinculo(db) -> None:
    """Remover o unico vinculo orfanaria o membro -> BusinessRuleError."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).remove_member_from_team(
                user_id=alvo, team_id=raiz
            )
        # nada foi removido.
        assert await _membership(db, user_id=alvo, team_id=raiz) is not None


async def test_manager_nao_remove_alvo_manager(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="mgr2@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=raiz, role="MANAGER")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).remove_member_from_team(
                user_id=alvo, team_id=raiz
            )


async def test_nao_remove_proprio_vinculo(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).remove_member_from_team(
                user_id=admin, team_id=raiz
            )


async def test_remove_vinculo_inexistente_404(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    solto = await f.make_user(db, workspace_id=ws, email="solto@t.dev")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).remove_member_from_team(
                user_id=solto, team_id=raiz
            )
