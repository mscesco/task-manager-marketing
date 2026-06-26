"""Spec 015, Fatia 1 -- GET /members/{id}/teams expoe (time, papel) do membro.

Pre-requisito da UI de administracao de papel: a tela precisa ver o papel
atual por time antes de oferecer alteracao.

Cobre: membro so na raiz (1 linha), membro em raiz+subtime (2 linhas, papeis
distintos), usuario inexistente (EntityNotFoundError -> 404).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import EntityNotFoundError
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def test_lista_papel_unico_na_raiz(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    user = await f.make_user(db, workspace_id=ws, email="u@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="MANAGER"
    )

    with acting_as(workspace_id=ws, user_id=user):
        vinculos = await MemberService(db).list_member_teams(user_id=user)

    assert len(vinculos) == 1
    assert vinculos[0].team_id == raiz
    assert vinculos[0].role == UserTeamRole.MANAGER


async def test_lista_papeis_raiz_e_subtime(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="seo"
    )
    user = await f.make_user(db, workspace_id=ws, email="dupla@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=seo, role="OPERATOR"
    )

    with acting_as(workspace_id=ws, user_id=user):
        vinculos = await MemberService(db).list_member_teams(user_id=user)

    por_time = {v.team_id: v.role for v in vinculos}
    assert len(vinculos) == 2
    assert por_time[raiz] == UserTeamRole.MANAGER
    assert por_time[seo] == UserTeamRole.OPERATOR


async def test_usuario_inexistente_404(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )

    with acting_as(workspace_id=ws, user_id=admin):
        with pytest.raises(EntityNotFoundError):
            await MemberService(db).list_member_teams(user_id=uuid.uuid4())
