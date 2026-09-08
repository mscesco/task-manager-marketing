"""Spec 045, fatia D -- a rota do papel de ORGANIZACAO, e a trava do ultimo admin.

⚠️⚠️ ESTA ROTA EXISTE PORQUE A INVARIANTE DE NIVEL A EXIGIU. Tirando `ADMIN` do
nivel de time, os dois unicos caminhos que criavam um admin morrem: o
provisionamento (que grava vinculo `user_team`) e o `POST /members` com
`role=ADMIN`. Sem uma rota propria, o sistema ficaria SEM NENHUMA forma de
criar ou promover um administrador ate a Spec 047 trazer as telas.

⚠️ E A TRAVA DO ULTIMO ADMIN NASCE JUNTO, de proposito. A spec pediu essa
invariante na fatia B e eu nao a implementei la -- estava certo por acidente:
sem rota de escrita nao havia como rebaixar ninguem, entao nao havia o que
guardar. Assim que a rota existe, ela passa a ser necessaria **e** possivel.

O que este arquivo prova:

    1. promover alguem a ADMIN de organizacao (sem tocar em time nenhum)
    2. rebaixar funciona quando ha outro admin
    3. ⭐ rebaixar o ULTIMO admin e recusado -- 409
    4. admin INATIVO nao conta para a trava
    5. GESTOR pode ser removido livremente (a trava e so do ADMIN)

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models import User
from app.db.models.enums import OrgRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _set_org_role(db, user_id, papel: OrgRole | None):
    user = await db.get(User, user_id)
    user.org_role = papel
    await db.flush()


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _set_org_role(db, dona, OrgRole.ADMIN)
    return ws, raiz, dona


async def test_promove_alguem_sem_tocar_em_time_nenhum(db) -> None:
    """⭐ O estado que a fatia B tornou normal: autoridade sem vinculo."""
    ws, raiz, dona = await _mundo(db)
    nova = await f.make_user(db, workspace_id=ws, email="nova@t.dev")

    with acting_as(workspace_id=ws, user_id=dona):
        svc = MemberService(db)
        user = await svc.change_organization_role(
            user_id=nova, new_role=OrgRole.GESTOR
        )
        # ⚠️ A LEITURA FICA DENTRO DO `acting_as`, e a primeira versao deste
        # teste a deixou de fora: o repositorio filtra por workspace e EXIGE
        # TenantContext (`BaseRepository._base_select`). Mesma lição que
        # `test_supervisor_remove_do_proprio_subtime` ja registra em
        # comentario -- e eu a repeti.
        vinculos = await svc._users.list_team_memberships(user_id=nova)

    assert user.org_role is OrgRole.GESTOR
    # E ela continua sem time nenhum -- a rota nao encosta em `user_team`.
    assert vinculos == []


async def test_rebaixar_funciona_quando_ha_outro_admin(db) -> None:
    ws, raiz, dona = await _mundo(db)
    segunda = await f.make_user(db, workspace_id=ws, email="segunda@t.dev")
    await _set_org_role(db, segunda, OrgRole.ADMIN)

    with acting_as(workspace_id=ws, user_id=dona):
        user = await MemberService(db).change_organization_role(
            user_id=segunda, new_role=None
        )

    assert user.org_role is None


async def test_rebaixar_o_ULTIMO_admin_e_recusado(db) -> None:
    """⭐ A trava. Sem ela, a organizacao se tranca sozinha.

    ⚠️ O modo de falhar seria irreversivel pela tela: sem nenhum ADMIN, ninguem
    tem `workspace.manage`, e `workspace.manage` e justamente o portao da rota
    que promoveria alguem de volta. A saida seria SQL na mao.

    Sabotagem: remover a chamada a `_assert_nao_e_o_ultimo_admin` faz este
    teste passar direto, e o proximo `change_organization_role` deixaria o
    workspace sem dono.
    """
    ws, raiz, dona = await _mundo(db)

    with acting_as(workspace_id=ws, user_id=dona):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )
        # E rebaixar para GESTOR tambem e rebaixar.
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=OrgRole.GESTOR
            )


async def test_admin_INATIVO_nao_conta_para_a_trava(db) -> None:
    """⚠️ A decisao que so aparece no dia.

    Um admin desativado nao administra nada. Se ele contasse, o ultimo admin
    ATIVO poderia ser rebaixado -- e a organizacao ficaria travada com a cara
    de "estava tudo certo, havia dois".
    """
    ws, raiz, dona = await _mundo(db)
    fantasma = await f.make_user(db, workspace_id=ws, email="fantasma@t.dev")
    await _set_org_role(db, fantasma, OrgRole.ADMIN)
    user = await db.get(User, fantasma)
    user.is_active = False
    await db.flush()

    with acting_as(workspace_id=ws, user_id=dona):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )


async def test_a_trava_e_so_do_admin_gestor_sai_livre(db) -> None:
    """GESTOR opera a organizacao; ele nao e o que a mantem destravada."""
    ws, raiz, dona = await _mundo(db)
    gestor = await f.make_user(db, workspace_id=ws, email="gestor@t.dev")
    await _set_org_role(db, gestor, OrgRole.GESTOR)

    with acting_as(workspace_id=ws, user_id=dona):
        user = await MemberService(db).change_organization_role(
            user_id=gestor, new_role=None
        )

    assert user.org_role is None
