"""Spec 047, fatia B -- a que AREAS cada pessoa pertence.

Alimenta a `/organizacao`: a contagem de cada card e o card "Pessoas sem
area". Uma pessoa pertence a uma area se tem vinculo NA area **ou em qualquer
subtime dela** -- a mesma regra da tabela da §4.2.

⚠️⚠️ POR QUE NAO DA PARA REUSAR `list_all_with_subteams`: aquela consulta
EXCLUI a raiz de proposito (quem esta na raiz nao pode ser rotulado com o id
do Marketing, senao o filtro de subtime do quadro perde o sentido). Resultado:
quem esta vinculado SO na area apareceria com lista vazia nos dois campos, e a
tela o classificaria como "sem area" -- o oposto da verdade.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
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
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=marketing, role="ADMIN"
    )
    await db.flush()
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(marketing, "ADMIN"),),
        team_tree=(
            node(marketing),
            node(seo, marketing),
            node(junior, seo),
            node(ti),
        ),
    )
    return ctx, ws, marketing, seo, junior, ti, admin


async def test_vinculo_SO_NA_AREA_conta_como_area(db) -> None:
    """⭐⭐ O caso que `list_all_with_subteams` nao consegue responder.

    Esta pessoa tem vinculo apenas na raiz. Em `subteam_ids` ela aparece com
    lista VAZIA -- correto, ela nao esta em subtime nenhum. Se a tela usasse
    aquele campo para o card "Pessoas sem area", ela cairia la, errada.
    """
    ctx, ws, marketing, seo, junior, ti, admin = await _mundo(db)
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert areas[admin] == [marketing]


async def test_vinculo_em_SUBTIME_sobe_para_a_area(db) -> None:
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    pessoa = await f.make_user(db, workspace_id=ws, email="seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=seo, role="OPERATOR"
    )
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert areas[pessoa] == [marketing]


async def test_vinculo_em_NETO_tambem_sobe(db) -> None:
    """⚠️ A SUBIDA E RECURSIVA, e este teste e o guardiao disso.

    A arvore tem tres niveis desde a Spec 036. Uma versao que olhasse so o pai
    direto classificaria esta pessoa como "sem area" -- e passaria em todos os
    outros testes deste arquivo.
    """
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    neta = await f.make_user(db, workspace_id=ws, email="jr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=neta, team_id=junior, role="OPERATOR"
    )
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert areas[neta] == [marketing]


async def test_pessoa_em_DUAS_areas_aparece_nas_duas(db) -> None:
    """⭐ O caso que a `/organizacao` existe para tornar visivel.

    Com N areas e uma pessoa podendo estar em varias, "onde esta a Fulana?"
    nao tem resposta numa grade por area -- e por isso a tela tem busca.
    """
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    dupla = await f.make_user(db, workspace_id=ws, email="dupla@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=seo, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=dupla, team_id=ti, role="OPERATOR"
    )
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert sorted(areas[dupla]) == sorted([marketing, ti])


async def test_dois_vinculos_na_MESMA_area_nao_duplicam(db) -> None:
    """⚠️ Sem o `DISTINCT`, quem esta na area E num subtime dela apareceria
    duas vezes -- e a contagem do card diria uma pessoa a mais."""
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    pessoa = await f.make_user(db, workspace_id=ws, email="dois@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=marketing, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=pessoa, team_id=seo, role="OPERATOR"
    )
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert areas[pessoa] == [marketing]


async def test_quem_nao_tem_vinculo_NAO_APARECE(db) -> None:
    """A conta de administracao da Camila, desde 08/09 -- e o card
    "Pessoas sem area" e feito exatamente deste conjunto."""
    ctx, ws, marketing, seo, junior, ti, _admin = await _mundo(db)
    solta = await f.make_user(db, workspace_id=ws, email="solta@t.dev")
    with acting_as(**ctx):
        areas = await UserRepository(db).areas_por_membro()
    assert solta not in areas
