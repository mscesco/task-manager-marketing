"""Entrega 13, Fatia 2 -- GET /members expoe o SUBTIME de cada membro.

Regra: subtime = time com parent_team_id != NULL. O time PRINCIPAL (raiz)
NAO rotula -- senao quem esta na raiz (ex.: managers do seed) viria com o
id do Marketing geral e o filtro de subtime no quadro perderia o sentido.
Pelo invariante "um subtime por usuario" (ADR 0008), cada membro tem 0 ou 1.

Cobre: raiz+subtime (escolhe o subtime), so-subtime, so-raiz (None),
sem-vinculo (None) e isolamento entre workspaces.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.modules.users.application.member_service import MemberService
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def test_member_traz_subtime_ignorando_raiz(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="seo"
    )

    # 1) na raiz E num subtime -> deve vir o SUBTIME, nao a raiz.
    dupla = await f.make_user(db, workspace_id=ws, email="dupla@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=raiz, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=design, role="OPERATOR"
    )

    # 2) so num subtime -> vem o subtime.
    so_sub = await f.make_user(db, workspace_id=ws, email="sosub@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=so_sub, team_id=seo, role="OPERATOR"
    )

    # 3) so na raiz -> sem subtime (None).
    so_raiz = await f.make_user(db, workspace_id=ws, email="soraiz@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=so_raiz, team_id=raiz, role="MANAGER"
    )

    # 4) sem vinculo nenhum -> None.
    solto = await f.make_user(db, workspace_id=ws, email="solto@t.dev")

    with acting_as(workspace_id=ws, user_id=dupla):
        membros = await MemberService(db).list_members()

    por_id = {m.user.id: m.subteam_id for m in membros}
    # A raiz e ignorada; o subtime e escolhido mesmo havendo 2 vinculos.
    assert por_id[dupla] == design
    assert por_id[so_sub] == seo
    assert por_id[so_raiz] is None
    assert por_id[solto] is None

    # Nenhuma duplicacao de membro mesmo com vinculo duplo (raiz+subtime).
    ids = [m.user.id for m in membros]
    assert len(ids) == len(set(ids))


async def test_subtime_nao_vaza_entre_workspaces(db) -> None:
    ws_a = await f.make_workspace(db, name="A")
    ws_b = await f.make_workspace(db, name="B")

    raiz_b = await f.make_team(db, workspace_id=ws_b, slug="marketing")
    sub_b = await f.make_team(
        db, workspace_id=ws_b, parent_team_id=raiz_b, slug="design"
    )
    u_b = await f.make_user(db, workspace_id=ws_b, email="b@t.dev")
    await f.add_member(
        db, workspace_id=ws_b, user_id=u_b, team_id=sub_b, role="OPERATOR"
    )

    u_a = await f.make_user(db, workspace_id=ws_a, email="a@t.dev")

    with acting_as(workspace_id=ws_a, user_id=u_a):
        membros = await MemberService(db).list_members()

    ids = {m.user.id for m in membros}
    assert u_a in ids
    assert u_b not in ids  # membro de outro tenant nao aparece
