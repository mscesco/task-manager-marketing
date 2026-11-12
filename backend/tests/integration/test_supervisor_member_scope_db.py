"""SUPERVISOR administra membros do PROPRIO subtime, e so dele.

    - nao alcanca outro subtime, nem para adicionar nem para remover;
    - cria, troca e tira par SUPERVISOR no proprio subtime, mas nao da MANAGER;
    - nao mexe no gerente da raiz;
    - com papeis divergentes, o escopo segue cada vinculo.

Tudo pelo service real contra o Postgres real, sem espiao.
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import AuthorizationError, BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _cenario(db):
    """Workspace com raiz + DOIS subtimes (para exercitar "outro subtime"),
    um supervisor em cada."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    crm = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    sup_seo = await f.make_user(db, workspace_id=ws, email="sup.seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup_seo, team_id=seo, role="SUPERVISOR"
    )
    sup_crm = await f.make_user(db, workspace_id=ws, email="sup.crm@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup_crm, team_id=crm, role="SUPERVISOR"
    )

    # Operador solto na raiz: e quem o supervisor vai puxar para o subtime.
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=raiz, role="OPERATOR"
    )
    return {
        "ws": ws, "raiz": raiz, "seo": seo, "crm": crm,
        "sup_seo": sup_seo, "sup_crm": sup_crm, "op": op,
        # ⚠️ A arvore e obrigatoria: sem `team_tree` o `acting_as` monta um
        # `frozenset`, `has_permission_in` responde a pergunta AMPLA e os testes
        # de "outro subtime" ficariam verdes com a trava errada.
        "arvore": (node(raiz), node(seo, raiz), node(crm, raiz)),
    }


def _como_supervisor(c, *, subtime_key="seo", ator_key="sup_seo"):
    return acting_as(
        workspace_id=c["ws"],
        user_id=c[ator_key],
        memberships=(Membership(team_id=c[subtime_key], role="SUPERVISOR"),),
        team_tree=c["arvore"],
    )


# ----------------------------------------------------------------- escopo


async def test_supervisor_adiciona_e_remove_no_proprio_subtime(db) -> None:
    """No proprio subtime: adiciona OPERATOR, remove-o e remove um par
    SUPERVISOR. Sem este, as travas poderiam recusar tudo e os 403 passariam."""
    c = await _cenario(db)
    outro_sup = await _operador_do_crm(db, c, "sup2@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=outro_sup,
        team_id=c["seo"], role="SUPERVISOR",
    )
    with _como_supervisor(c):
        svc = MemberService(db)
        ut = await svc.assign_to_team(
            user_id=c["op"], team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
        assert (ut.team_id, ut.role) == (c["seo"], UserTeamRole.OPERATOR)
        await svc.remove_member_from_team(user_id=c["op"], team_id=c["seo"])
        await svc.remove_member_from_team(user_id=outro_sup, team_id=c["seo"])
        # Leitura dentro do acting_as: o repositorio exige TenantContext.
        do_op = {ut.team_id for ut in await svc.list_member_teams(user_id=c["op"])}
        do_par = {
            ut.team_id for ut in await svc.list_member_teams(user_id=outro_sup)
        }
    assert do_op == {c["raiz"]}  # o vinculo de origem continua
    assert do_par == {c["crm"]}


async def test_supervisor_nao_alcanca_outro_subtime(db) -> None:
    """Supervisor de SEO tentando povoar o CRM -> 403."""
    c = await _cenario(db)
    with _como_supervisor(c):  # ator e supervisor de SEO
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=c["op"], team_id=c["crm"], role=UserTeamRole.OPERATOR
            )


async def test_supervisor_nao_remove_de_outro_subtime(db) -> None:
    """A mesma trava no caminho de REMOVER, nao so no de adicionar."""
    c = await _cenario(db)
    # O operador entra no CRM pela mao do supervisor de la (legitimo).
    with _como_supervisor(c, subtime_key="crm", ator_key="sup_crm"):
        await MemberService(db).assign_to_team(
            user_id=c["op"], team_id=c["crm"], role=UserTeamRole.OPERATOR
        )
    # O supervisor de SEO tenta tirar de la -> 403.
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).remove_member_from_team(
                user_id=c["op"], team_id=c["crm"]
            )


# ----------------------------------------------------------------- papel
#
# O supervisor promove e rebaixa no proprio subtime, inclusive um par; o que
# continua travado esta nas metades negativas de cada teste.
#
# ⚠️ O alvo nao esta na raiz: OPERATOR na raiz promovido a SUPERVISOR no
# subtime esbarra em "papel na raiz nao pode ser menor" (409), e o teste
# mediria essa regra em vez da permissao.


async def _operador_do_crm(db, c, email: str):
    uid = await f.make_user(db, workspace_id=c["ws"], email=email)
    await f.add_member(
        db, workspace_id=c["ws"], user_id=uid, team_id=c["crm"], role="OPERATOR"
    )
    return uid


async def test_supervisor_atribui_supervisor_no_proprio_subtime(db) -> None:
    """O supervisor cria par no subtime dele, e so ate supervisor."""
    c = await _cenario(db)
    pessoa = await _operador_do_crm(db, c, "pessoa@t.dev")
    with _como_supervisor(c):
        svc = MemberService(db)
        ut = await svc.assign_to_team(
            user_id=pessoa, team_id=c["seo"], role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR
        # O teto e o NIVEL: gerente nao existe em subtime (409, regra de dominio).
        outra = await _operador_do_crm(db, c, "outra@t.dev")
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outra, team_id=c["seo"], role=UserTeamRole.MANAGER
            )


async def test_supervisor_troca_papel_no_proprio_subtime(db) -> None:
    """Promove e rebaixa no subtime dele; fora dele, 403."""
    c = await _cenario(db)
    pessoa = await _operador_do_crm(db, c, "pessoa@t.dev")
    with _como_supervisor(c):
        svc = MemberService(db)
        await svc.assign_to_team(
            user_id=pessoa, team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
        promovido = await svc.change_member_role(
            user_id=pessoa, team_id=c["seo"], new_role=UserTeamRole.SUPERVISOR
        )
        assert promovido.role == UserTeamRole.SUPERVISOR
        # E rebaixa um par.
        rebaixado = await svc.change_member_role(
            user_id=pessoa, team_id=c["seo"], new_role=UserTeamRole.OPERATOR
        )
        assert rebaixado.role == UserTeamRole.OPERATOR
        # O vinculo do CRM nao e dele.
        with pytest.raises(AuthorizationError):
            await svc.change_member_role(
                user_id=pessoa, team_id=c["crm"], new_role=UserTeamRole.SUPERVISOR
            )


async def test_supervisor_nao_mexe_em_manager(db) -> None:
    """Alvo MANAGER -> 403: o gerente mora na RAIZ, onde o supervisor nao tem
    `membership.delete`, e a matriz de papeis recusa o alvo."""
    c = await _cenario(db)
    chefe = await f.make_user(db, workspace_id=c["ws"], email="manager@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=chefe,
        team_id=c["raiz"], role="MANAGER",
    )
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).remove_member_from_team(
                user_id=chefe, team_id=c["raiz"]
            )


async def test_papeis_divergentes_o_escopo_segue_o_vinculo(db) -> None:
    """SUPERVISOR em SEO + OPERATOR em CRM: administra onde e supervisora, e
    so ali, mesmo tendo `membership.create` pela uniao dos papeis.

    `permissions_for_actor` concede `membership.*` ao papel de execucao so no
    time daquele vinculo; o OPERATOR do CRM nao tem o verbo.
    """
    c = await _cenario(db)

    # A supervisora do SEO ganha, pelo servico, um vinculo de OPERATOR no CRM.
    admin = await f.make_user(
        db, workspace_id=c["ws"], email="adm@t.dev", org_role="ADMIN"
    )
    with acting_as(
        workspace_id=c["ws"], user_id=admin,
        team_tree=c["arvore"], org_role="ADMIN",
    ):
        await MemberService(db).assign_to_team(
            user_id=c["sup_seo"], team_id=c["crm"], role=UserTeamRole.OPERATOR
        )

    divergente = (
        Membership(team_id=c["seo"], role="SUPERVISOR"),
        Membership(team_id=c["crm"], role="OPERATOR"),
    )

    # No SEO, onde ela e SUPERVISORA: administra.
    with acting_as(
        workspace_id=c["ws"], user_id=c["sup_seo"], memberships=divergente,
        team_tree=c["arvore"],
    ):
        ut = await MemberService(db).assign_to_team(
            user_id=c["op"], team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
        assert ut.team_id == c["seo"]

    # No CRM, onde ela e apenas OPERADORA: 403 -- ainda que a uniao dos
    # papeis lhe de `member.manage.subteam`.
    with acting_as(
        workspace_id=c["ws"], user_id=c["sup_seo"], memberships=divergente,
        team_tree=c["arvore"],
    ):
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=c["op"], team_id=c["crm"], role=UserTeamRole.OPERATOR
            )
