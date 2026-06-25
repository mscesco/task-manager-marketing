"""Spec 014 -- cadastro de membro escolhendo time (principal OU subtime) + cargo.

Regra nova:
- team_id e role AMBOS obrigatorios (sem membro orfao).
- time pode ser o PRINCIPAL (raiz) ou um SUBTIME -- escolha explicita.
- gate D2: criar role=ADMIN exige que o ATOR seja ADMIN.

Cobre: bind no principal, bind no subtime (regressao), gate de ADMIN
(MANAGER bloqueado / ADMIN liberado) e team_id inexistente (404).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def test_cadastro_no_principal_vincula_na_raiz(db) -> None:
    """Sem subtime: escolher o principal vincula o cargo na raiz (nao orfao)."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        prov = await MemberService(db).create_member(
            CreateMemberCommand(
                name="Novo Geral",
                email="geral@t.dev",
                team_id=raiz,
                role=UserTeamRole.MANAGER,
            )
        )
        # vinculo existe e aponta para a raiz, com o papel escolhido.
        vinculos = await MemberService(db)._users.list_team_memberships(
            user_id=prov.user.id
        )
        assert len(vinculos) == 1
        assert vinculos[0].team_id == raiz
        assert vinculos[0].role == UserTeamRole.MANAGER


async def test_cadastro_em_subtime_vincula_no_subtime(db) -> None:
    """Com subtime: comportamento de hoje, intocado (vinculo no subtime)."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="seo"
    )
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        prov = await MemberService(db).create_member(
            CreateMemberCommand(
                name="Pessoa SEO",
                email="seo@t.dev",
                team_id=seo,
                role=UserTeamRole.OPERATOR,
            )
        )
        vinculos = await MemberService(db)._users.list_team_memberships(
            user_id=prov.user.id
        )
        assert len(vinculos) == 1
        assert vinculos[0].team_id == seo
        assert vinculos[0].role == UserTeamRole.OPERATOR


async def test_manager_nao_cria_admin(db) -> None:
    """Gate D2: ator MANAGER tentando criar role=ADMIN -> 403."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    manager = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=manager, team_id=raiz, role="MANAGER"
    )

    with acting_as(
        workspace_id=ws,
        user_id=manager,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).create_member(
                CreateMemberCommand(
                    name="Tentativa Admin",
                    email="novoadmin@t.dev",
                    team_id=raiz,
                    role=UserTeamRole.ADMIN,
                )
            )


async def test_admin_cria_admin(db) -> None:
    """Gate D2: ator ADMIN pode criar role=ADMIN."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        prov = await MemberService(db).create_member(
            CreateMemberCommand(
                name="Outro Admin",
                email="outroadmin@t.dev",
                team_id=raiz,
                role=UserTeamRole.ADMIN,
            )
        )
        vinculos = await MemberService(db)._users.list_team_memberships(
            user_id=prov.user.id
        )
        assert vinculos[0].role == UserTeamRole.ADMIN


async def test_team_inexistente_404(db) -> None:
    """team_id que nao existe no workspace -> EntityNotFoundError (404)."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )

    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    ):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).create_member(
                CreateMemberCommand(
                    name="Sem Time",
                    email="semtime@t.dev",
                    team_id=uuid.uuid4(),  # inexistente
                    role=UserTeamRole.OPERATOR,
                )
            )
