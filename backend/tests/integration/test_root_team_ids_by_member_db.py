"""`UserRepository.root_team_ids_by_member`: a que times raiz cada pessoa pertence.

Vinculo na raiz ou em qualquer subtime dela conta. Nao da para reusar
`list_all_with_subteams`: ela exclui a raiz, e quem esta so na raiz sairia sem time.
"""

from __future__ import annotations

import pytest

from app.modules.users.infrastructure.user_repository import UserRepository
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Marketing -> SEO -> SEO Junior (tres niveis), e o TI ao lado."""
    ws = await f.make_workspace(db)
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=marketing, slug="seo")
    junior = await f.make_team(
        db, workspace_id=ws, parent_team_id=seo, slug="seo-junior"
    )
    ti = await f.make_team(db, workspace_id=ws, slug="ti")
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    # Papel de organizacao nao e vinculo de time: o MANAGER e que poe o admin na raiz.
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=marketing, role="MANAGER"
    )
    await db.flush()
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(marketing, "MANAGER"),),
        org_role="ADMIN",
        team_tree=(
            node(marketing),
            node(seo, marketing),
            node(junior, seo),
            node(ti),
        ),
    )
    return ctx, ws, marketing, seo, junior, ti, admin


async def test_vinculo_SO_NA_RAIZ_conta(db) -> None:
    ctx, ws, marketing, seo, junior, ti, admin = await _mundo(db)
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert roots[admin] == [marketing]


async def test_vinculo_em_SUBTIME_sobe_para_a_raiz(db) -> None:
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    pessoa = await f.make_user(db, workspace_id=ws, email="seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=seo, role="OPERATOR"
    )
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert roots[pessoa] == [marketing]


async def test_vinculo_em_NETO_tambem_sobe(db) -> None:
    """A subida e recursiva, nao so ate o pai direto."""
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    neta = await f.make_user(db, workspace_id=ws, email="jr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=neta, team_id=junior, role="OPERATOR"
    )
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert roots[neta] == [marketing]


async def test_pessoa_em_DOIS_times_raiz_aparece_nos_dois(db) -> None:
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    dupla = await f.make_user(db, workspace_id=ws, email="dupla@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=seo, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=ti, role="OPERATOR"
    )
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert sorted(roots[dupla]) == sorted([marketing, ti])


async def test_dois_vinculos_na_MESMA_raiz_nao_duplicam(db) -> None:
    """Sem o `DISTINCT`, raiz + subtime contaria a pessoa duas vezes."""
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    pessoa = await f.make_user(db, workspace_id=ws, email="dois@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=marketing, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=seo, role="OPERATOR"
    )
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert roots[pessoa] == [marketing]


async def test_quem_nao_tem_vinculo_NAO_APARECE(db) -> None:
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    solta = await f.make_user(db, workspace_id=ws, email="solta@t.dev")
    with acting_as(**ctx):
        roots = await UserRepository(db).root_team_ids_by_member()
    assert solta not in roots
