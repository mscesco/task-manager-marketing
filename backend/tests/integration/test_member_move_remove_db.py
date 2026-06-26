"""Spec 015, Fatia 4 -- mover (B2) e remover (B3) vinculo de membro.

Regras:
    C1 -- ao remover/mover, a pessoa perde acesso; tarefas ficam (nao testavel
          aqui, pois e dormente: tudo roda na raiz).
    C2 -- matriz: ADMIN qualquer; MANAGER so SUPERVISOR/OPERATOR.
    C3 -- ninguem remove/move a si mesmo.
    1-subtime -- mover nunca deixa a pessoa em 2 subtimes.

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
    ConflictError,
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


# --------------------------------------------------------
# B2 -- mover de subtime
# --------------------------------------------------------
async def test_move_subtime_preserva_papel_e_um_subtime(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="design")
    b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="SUPERVISOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        await MemberService(db).move_member_subteam(
            user_id=alvo, from_team_id=a, to_team_id=b
        )
        assert await _membership(db, user_id=alvo, team_id=a) is None
        destino = await _membership(db, user_id=alvo, team_id=b)
        assert destino is not None
        assert destino.role == UserTeamRole.SUPERVISOR  # papel preservado
        # 1-subtime: apenas um vinculo de subtime
        todos = await MemberService(db)._users.list_team_memberships(user_id=alvo)
        assert len(todos) == 1


async def test_move_subtime_para_raiz_vira_geral(db) -> None:
    """'Tirar do subtime' = mover pra raiz, preservando o papel.

    A pessoa estava so no subtime; apos mover, fica so na raiz (geral) e
    deixa de ter subtime.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    dev = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="dev")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="jaque@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=dev, role="SUPERVISOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        await MemberService(db).move_member_subteam(
            user_id=alvo, from_team_id=dev, to_team_id=raiz
        )
        assert await _membership(db, user_id=alvo, team_id=dev) is None
        na_raiz = await _membership(db, user_id=alvo, team_id=raiz)
        assert na_raiz is not None
        assert na_raiz.role == UserTeamRole.SUPERVISOR  # papel preservado
        todos = await MemberService(db)._users.list_team_memberships(user_id=alvo)
        assert len(todos) == 1


async def test_move_origem_destino_iguais(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="design")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).move_member_subteam(
                user_id=alvo, from_team_id=a, to_team_id=a
            )


async def test_manager_nao_move_alvo_manager(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="design")
    b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    alvo = await f.make_user(db, workspace_id=ws, email="mgr2@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="MANAGER")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).move_member_subteam(
                user_id=alvo, from_team_id=a, to_team_id=b
            )


async def test_move_destino_inexistente_404(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="design")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN")
    alvo = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).move_member_subteam(
                user_id=alvo, from_team_id=a, to_team_id=uuid.uuid4()
            )
