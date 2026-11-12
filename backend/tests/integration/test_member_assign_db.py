"""Adicionar membro existente a um time (`assign_to_team`).

ADMIN de organizacao atribui qualquer papel; MANAGER so SUPERVISOR/OPERATOR.
Adicionar e aditivo (sem self-guard). O mesmo time duas vezes e 409; um segundo
subtime e aceito.
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    ConflictError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def test_admin_adiciona_qualquer_papel(db) -> None:
    """ADMIN de organizacao alcanca qualquer papel; mas MANAGER so existe no
    time raiz, e essa invariante de nivel vale mesmo para o ADMIN."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    # ⚠️ SEM VINCULO NA RAIZ, de proposito: papel na raiz MENOR que no subtime
    # e proibido, mas ausencia nao e menos.
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    outro = await f.make_user(db, workspace_id=ws, email="outro@t.dev")

    with acting_as(
        workspace_id=ws, user_id=admin,
        org_role="ADMIN",
    ):
        svc = MemberService(db)
        # Papel de execucao em subtime: a matriz permite e o nivel aceita.
        ut = await svc.assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )
        assert ut.team_id == seo
        assert ut.role == UserTeamRole.SUPERVISOR

        # MANAGER em SUBTIME e recusado mesmo o ator sendo ADMIN: quem barra e
        # a invariante de nivel, nao a matriz de papeis.
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outro, team_id=seo, role=UserTeamRole.MANAGER
            )


async def test_manager_adiciona_supervisor(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")
    # Sem vinculo na raiz (ver o teste acima), mas COM vinculo na arvore
    # (Design): quem nao e da organizacao so vincula quem ja esta na arvore.
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=design, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
        # "Ja esta na arvore" pergunta a raiz de cada time; sem `team_tree`, o
        # SEO e o Design seriam raizes de si mesmos.
        team_tree=(node(raiz), node(seo, raiz), node(design, raiz)),
    ):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR


async def test_manager_nao_adiciona_manager(db) -> None:
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
                user_id=alvo, team_id=seo, role=UserTeamRole.MANAGER
            )


async def test_segundo_subtime_agora_e_aceito_pelo_servico(db) -> None:
    """Um membro pode estar em dois subtimes: o segundo vinculo nasce pelo
    servico. (A consulta que devolve os dois: `test_member_subteam_db`.)"""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    midias = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias-sociais"
    )
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    redatora = await f.make_user(db, workspace_id=ws, email="redatora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=midias, role="OPERATOR"
    )

    with acting_as(
        workspace_id=ws, user_id=admin,
        org_role="ADMIN",
    ):
        svc = MemberService(db)
        ut = await svc.assign_to_team(
            user_id=redatora, team_id=seo, role=UserTeamRole.OPERATOR
        )
        assert ut.team_id == seo
        assert ut.role == UserTeamRole.OPERATOR


async def test_vinculo_repetido_no_mesmo_time_continua_409(db) -> None:
    """`UNIQUE (user_id, team_id)`: o mesmo time duas vezes e 409."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR")

    with acting_as(
        workspace_id=ws, user_id=admin,
        org_role="ADMIN",
    ):
        with pytest.raises(ConflictError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.OPERATOR
            )
