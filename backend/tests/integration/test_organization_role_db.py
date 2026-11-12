"""Rota do papel de organizacao e trava do ultimo admin.

Sem nenhum ADMIN ativo ninguem tem `workspace.manage`, que e o portao para
promover alguem de volta: a saida seria SQL na mao.
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
    """Autoridade de organizacao sem vinculo de time."""
    ws, raiz, dona = await _mundo(db)
    nova = await f.make_user(db, workspace_id=ws, email="nova@t.dev")

    with acting_as(workspace_id=ws, user_id=dona, org_role="ADMIN"):
        svc = MemberService(db)
        user = await svc.change_organization_role(
            user_id=nova, new_role=OrgRole.GESTOR
        )
        # A leitura fica dentro do `acting_as`: o repositorio exige TenantContext.
        vinculos = await svc._users.list_team_memberships(user_id=nova)

    assert user.org_role is OrgRole.GESTOR
    # Continua sem time: a rota nao encosta em `user_team`.
    assert vinculos == []


async def test_rebaixar_funciona_quando_ha_outro_admin(db) -> None:
    ws, raiz, dona = await _mundo(db)
    segunda = await f.make_user(db, workspace_id=ws, email="segunda@t.dev")
    await _set_org_role(db, segunda, OrgRole.ADMIN)

    with acting_as(workspace_id=ws, user_id=dona, org_role="ADMIN"):
        user = await MemberService(db).change_organization_role(
            user_id=segunda, new_role=None
        )

    assert user.org_role is None


async def test_rebaixar_o_ULTIMO_admin_e_recusado(db) -> None:
    """Rebaixar o ultimo admin e recusado (409)."""
    ws, raiz, dona = await _mundo(db)

    with acting_as(workspace_id=ws, user_id=dona, org_role="ADMIN"):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )
        # Rebaixar para GESTOR tambem e rebaixar.
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=OrgRole.GESTOR
            )


async def test_admin_INATIVO_nao_conta_para_a_trava(db) -> None:
    """Admin inativo nao conta: senao o ultimo ativo poderia ser rebaixado."""
    ws, raiz, dona = await _mundo(db)
    fantasma = await f.make_user(db, workspace_id=ws, email="fantasma@t.dev")
    await _set_org_role(db, fantasma, OrgRole.ADMIN)
    user = await db.get(User, fantasma)
    user.is_active = False
    await db.flush()

    with acting_as(workspace_id=ws, user_id=dona, org_role="ADMIN"):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )


async def test_a_trava_e_so_do_admin_gestor_sai_livre(db) -> None:
    """GESTOR opera a organizacao; ele nao e o que a mantem destravada."""
    ws, raiz, dona = await _mundo(db)
    gestor = await f.make_user(db, workspace_id=ws, email="gestor@t.dev")
    await _set_org_role(db, gestor, OrgRole.GESTOR)

    with acting_as(workspace_id=ws, user_id=dona, org_role="ADMIN"):
        user = await MemberService(db).change_organization_role(
            user_id=gestor, new_role=None
        )

    assert user.org_role is None
