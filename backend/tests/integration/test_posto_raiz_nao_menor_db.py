"""O papel na RAIZ nao pode ser menor que o papel no subtime.

    OPERATOR@raiz   + SUPERVISOR@sub -> recusado (a inversao)
    MANAGER@raiz    + SUPERVISOR@sub -> recusado, mas por outra regra (comando
                                        na raiz com vinculo embaixo)
    SUPERVISOR@raiz + OPERATOR@sub   -> passa
    NENHUM@raiz     + SUPERVISOR@sub -> passa: ausencia nao e "menos"

Os dois sentidos importam: adicionar o subtime e rebaixar a raiz chegam ao
mesmo estado invalido.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    # ADMIN de organizacao: sem vinculo de time.
    admin = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await db.flush()
    return ws, raiz, seo, admin, alvo


def _como_admin(ws, raiz, admin):
    return acting_as(workspace_id=ws, user_id=admin, org_role="ADMIN")


async def test_operador_na_raiz_nao_vira_supervisor_no_subtime(db) -> None:
    """A inversao, pela porta de ADICIONAR."""
    ws, raiz, seo, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR"
    )

    with _como_admin(ws, raiz, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
            )


async def test_rebaixar_a_raiz_de_quem_supervisiona_subtime_e_recusado(db) -> None:
    """A mesma inversao, pela porta de TROCAR PAPEL: rebaixar a raiz de quem
    ja supervisiona um subtime."""
    ws, raiz, seo, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=seo, role="SUPERVISOR"
    )

    with _como_admin(ws, raiz, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_o_service_recusa_esse_mesmo_caso_pela_regra_da_045(db) -> None:
    """MANAGER na raiz + SUPERVISOR no subtime: a comparacao de posto passa,
    mas a regra de comando na raiz com vinculo embaixo recusa."""
    ws, raiz, seo, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="MANAGER"
    )

    with _como_admin(ws, raiz, admin):
        with pytest.raises(BusinessRuleError) as exc:
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
            )
    # A mensagem e a do comando na raiz, nao a de posto: senao a pessoa tenta
    # "consertar" subindo o papel, que e o oposto do que resolve.
    assert "alcancam todos os subtimes" in str(exc.value)


async def test_sem_vinculo_na_raiz_o_supervisor_de_subtime_passa(db) -> None:
    """Ausencia na raiz nao e "menos": tratar como posto 0 barraria todo
    supervisor de subtime sem cadastro na raiz, o caso normal."""
    ws, raiz, seo, admin, alvo = await _mundo(db)

    with _como_admin(ws, raiz, admin):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )

    assert ut.role == UserTeamRole.SUPERVISOR


async def test_supervisor_na_raiz_com_operador_no_subtime_passa(db) -> None:
    """O sentido certo (raiz maior) nunca e barrado."""
    ws, raiz, seo, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="SUPERVISOR"
    )

    with _como_admin(ws, raiz, admin):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.OPERATOR
        )

    assert ut.role == UserTeamRole.OPERATOR
