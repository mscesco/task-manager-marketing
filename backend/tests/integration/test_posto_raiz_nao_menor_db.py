"""Spec 044, fatia 5 (§4.1-bis) -- o papel na RAIZ nao pode ser menor.

Regra da Camila, 31/08: *"Ele nao pode ter menos permissao no raiz do que tem
no subtime."*

    OPERATOR@raiz   + SUPERVISOR@sub -> ❌ e a inversao que a regra mata
    MANAGER@raiz    + SUPERVISOR@sub -> ✅ ("mesmo nao fazendo sentido")
    SUPERVISOR@raiz + OPERATOR@sub   -> ✅
    NENHUM@raiz     + SUPERVISOR@sub -> ✅ ausencia NAO e "menos"

⚠️ SEJA HONESTO SOBRE O QUE ELA FAZ: nao tapa furo de seguranca. Os gates de
escopo (`_assert_escopo_supervisor`) ja seguram o caso -- um OPERATOR da raiz
que fosse SUPERVISOR de um subtime nao alcancaria nada indevido. Ela impede
ORGANOGRAMA INCOERENTE.

⚠️ MAS NAO E DECORATIVA, e o motivo esta no mapa de permissoes: ele NAO e
monotonico. `member.manage.subteam` existe so no SUPERVISOR
(`permissions.py`), e MANAGER nao a tem. Hoje o early return de
`_tem_gestao_ampla` neutraliza; o dia em que alguem mexer no mapa, nao.

✅ Varredura rodada no Adminer em 31/08: nenhum registro em estado invalido.
A regra liga sem remediacao de cadastro. A consulta esta na §4.1-bis da spec.

⚠️ OS DOIS SENTIDOS IMPORTAM. Barrar so "subir o subtime" deixaria a inversao
entrar pela outra porta: REBAIXAR a raiz de quem ja supervisiona um subtime
produz o mesmo estado invalido, e e o caminho mais provavel na pratica.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
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
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await db.flush()
    return ws, raiz, seo, admin, alvo


def _como_admin(ws, raiz, admin):
    return acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
    )


async def test_operador_na_raiz_nao_vira_supervisor_no_subtime(db) -> None:
    """⭐ A inversao, pela porta de ADICIONAR (porta 2 de 4)."""
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
    """⭐ A MESMA inversao, pela porta de TROCAR PAPEL (porta 3 de 4).

    ⚠️ Este e o caminho provavel na pratica: ninguem promove alguem a
    supervisor de subtime sendo operador da raiz -- mas rebaixar a raiz de quem
    ja supervisiona acontece. Sem esta porta, a regra valeria so na metade dos
    caminhos, que e o formato exato do defeito que a ADR 0031 corrigiu.
    """
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


async def test_manager_na_raiz_com_supervisor_no_subtime_e_permitido(db) -> None:
    """Decisao da Camila: vale, *"mesmo nao fazendo sentido"*.

    A regra compara POSTO, e nao coerencia de organograma. MANAGER (3) nao e
    menor que SUPERVISOR (2), entao passa.
    """
    ws, raiz, seo, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="MANAGER"
    )

    with _como_admin(ws, raiz, admin):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )

    assert ut.role == UserTeamRole.SUPERVISOR


async def test_sem_vinculo_na_raiz_o_supervisor_de_subtime_passa(db) -> None:
    """⭐ AUSENCIA NAO E "MENOS" -- decisao explicita da Camila, 31/08.

    ⚠️ Tratar ausencia como posto 0 barraria TODO supervisor de subtime que
    nunca foi cadastrado na raiz, que e o cadastro normal do produto. E o
    unico caso desta fatia que muda o comportamento de gente real se for
    implementado errado.
    """
    ws, raiz, seo, admin, alvo = await _mundo(db)

    with _como_admin(ws, raiz, admin):
        ut = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )

    assert ut.role == UserTeamRole.SUPERVISOR


async def test_mover_entre_subtimes_com_raiz_menor_e_recusado(db) -> None:
    """Porta 4 de 4 -- `move_member_subteam`, com cadastro LEGADO.

    ⚠️ O ESTADO DE PARTIDA E INVALIDO DE PROPOSITO, e so a factory consegue
    escreve-lo: as portas 2 e 3 ja o recusam. Ele representa o cadastro que
    existiria se a varredura de 31/08 tivesse voltado linhas -- e a spec diz
    que, se um dia voltar, a regra nao pode ser ligada sem decidir o que fazer
    com essas pessoas. Este teste prende o comportamento nesse caso: mover nao
    conserta a inversao, entao mover e recusado.
    """
    ws, raiz, seo, admin, alvo = await _mundo(db)
    outro_sub = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=raiz, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=seo, role="SUPERVISOR"
    )

    with _como_admin(ws, raiz, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).move_member_subteam(
                user_id=alvo, from_team_id=seo, to_team_id=outro_sub
            )


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
