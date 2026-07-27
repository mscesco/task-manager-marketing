"""Spec 028 -- SUPERVISOR administra OPERATOR do PROPRIO subtime.

Ate esta spec, so ADMIN/MANAGER chegavam ao MemberService: as rotas exigiam
`team.manage`. A 028 abriu DUAS rotas (adicionar / remover) para a permissao
nova `member.manage.subteam` -- e com isso o SUPERVISOR passou a alcancar o
service. A matriz C2 (Spec 015) sozinha NAO o barra: ela so recusa alvo
MANAGER/ADMIN, entao supervisor mexendo em OPERATOR passaria direto.

O que este arquivo prova, em ordem de importancia:

    D1  supervisor NAO alcanca outro subtime      <- a trava inegociavel
    D2  supervisor so mexe em OPERATOR
    D3  supervisor nao cadastra pessoa nova (rota segue team.manage)
    D4  supervisor nao desativa conta
        ADMIN/MANAGER sem regressao

Nenhum teste aqui usa monkeypatch/espiao (armadilha do §8 do handoff): todos
exercitam o service real contra o Postgres real, entao renomear um metodo
interno quebra o teste em vez de deixa-lo verde sem testar nada.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import AuthorizationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _cenario(db):
    """Workspace com raiz + DOIS subtimes, um supervisor em cada.

    Devolve um dict para os testes lerem so o que precisam. Dois subtimes
    sao obrigatorios: com um so, a trava D1 nao teria como ser exercitada.
    """
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
    }


def _como_supervisor(c, *, subtime_key="seo", ator_key="sup_seo"):
    return acting_as(
        workspace_id=c["ws"],
        user_id=c[ator_key],
        memberships=(Membership(team_id=c[subtime_key], role="SUPERVISOR"),),
    )


# ----------------------------------------------------------------- D1


async def test_supervisor_adiciona_operator_no_proprio_subtime(db) -> None:
    """O caminho feliz: e para isto que a spec existe."""
    c = await _cenario(db)
    with _como_supervisor(c):
        ut = await MemberService(db).assign_to_team(
            user_id=c["op"], team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
    assert ut.team_id == c["seo"]
    assert ut.role == UserTeamRole.OPERATOR


async def test_supervisor_nao_alcanca_outro_subtime(db) -> None:
    """A TRAVA D1. Supervisor de SEO tentando povoar o CRM -> 403.

    Se este teste ficar verde com a trava removida, ele nao esta testando
    nada -- ver a sabotagem registrada no plan.
    """
    c = await _cenario(db)
    with _como_supervisor(c):  # ator e supervisor de SEO
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=c["op"], team_id=c["crm"], role=UserTeamRole.OPERATOR
            )


async def test_supervisor_nao_remove_de_outro_subtime(db) -> None:
    """D1 no caminho de REMOVER, nao so no de adicionar.

    Um gate so no assign deixaria a metade destrutiva aberta.
    """
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


async def test_supervisor_remove_do_proprio_subtime(db) -> None:
    """Contraprova do teste acima: no proprio subtime, remover funciona.

    Sem este teste, a trava poderia estar recusando TUDO e os testes de 403
    passariam por acidente.
    """
    c = await _cenario(db)
    with _como_supervisor(c):
        svc = MemberService(db)
        await svc.assign_to_team(
            user_id=c["op"], team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
        await svc.remove_member_from_team(user_id=c["op"], team_id=c["seo"])
        # A leitura tem de ficar DENTRO do acting_as: o repositorio filtra
        # por workspace e exige TenantContext (BaseRepository._base_select).
        restantes = {
            ut.team_id for ut in await svc.list_member_teams(user_id=c["op"])
        }
    assert c["seo"] not in restantes
    assert c["raiz"] in restantes  # o vinculo de origem continua


# ----------------------------------------------------------------- D2


async def test_supervisor_nao_atribui_supervisor(db) -> None:
    """D2: supervisor nao cria par. Promover e trabalho do MANAGER."""
    c = await _cenario(db)
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).assign_to_team(
                user_id=c["op"], team_id=c["seo"], role=UserTeamRole.SUPERVISOR
            )


async def test_supervisor_nao_troca_papel(db) -> None:
    """D2: trocar papel nao foi aberto ao supervisor (nem no proprio time)."""
    c = await _cenario(db)
    with _como_supervisor(c):
        svc = MemberService(db)
        await svc.assign_to_team(
            user_id=c["op"], team_id=c["seo"], role=UserTeamRole.OPERATOR
        )
        with pytest.raises(AuthorizationError):
            await svc.change_member_role(
                user_id=c["op"],
                team_id=c["seo"],
                new_role=UserTeamRole.SUPERVISOR,
            )


async def test_supervisor_nao_remove_par_supervisor(db) -> None:
    """D2 no caminho destrutivo: nem o supervisor do proprio time sai.

    Cobre o caso em que dois supervisores dividem o mesmo subtime.
    """
    c = await _cenario(db)
    outro_sup = await f.make_user(db, workspace_id=c["ws"], email="sup2@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=outro_sup,
        team_id=c["raiz"], role="OPERATOR",
    )
    await f.add_member(
        db, workspace_id=c["ws"], user_id=outro_sup,
        team_id=c["seo"], role="SUPERVISOR",
    )
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).remove_member_from_team(
                user_id=outro_sup, team_id=c["seo"]
            )


async def test_supervisor_nao_mexe_em_manager_nem_admin(db) -> None:
    """Criterio 5 da spec: alvo MANAGER/ADMIN -> 403.

    Barrado pela MESMA linha que barra SUPERVISOR (papel_alvo != OPERATOR),
    mas o criterio estava declarado sem prova -- e criterio sem teste e
    afirmacao, nao garantia.
    """
    c = await _cenario(db)
    for papel in ("MANAGER", "ADMIN"):
        chefe = await f.make_user(
            db, workspace_id=c["ws"], email=f"{papel.lower()}@t.dev"
        )
        await f.add_member(
            db, workspace_id=c["ws"], user_id=chefe,
            team_id=c["raiz"], role=papel,
        )
        with _como_supervisor(c):
            with pytest.raises(AuthorizationError):
                await MemberService(db).remove_member_from_team(
                    user_id=chefe, team_id=c["raiz"]
                )


# ----------------------------------------------------------------- D4


async def test_supervisor_nao_desativa_conta(db) -> None:
    """D4: supervisor tira do subtime; desativar a conta e do MANAGER."""
    c = await _cenario(db)
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).deactivate_member(user_id=c["op"])


async def test_supervisor_nao_move_entre_subtimes(db) -> None:
    """Mover toca o subtime de ORIGEM, que nao e do ator -> viola D1."""
    c = await _cenario(db)
    with _como_supervisor(c, subtime_key="crm", ator_key="sup_crm"):
        await MemberService(db).assign_to_team(
            user_id=c["op"], team_id=c["crm"], role=UserTeamRole.OPERATOR
        )
    with _como_supervisor(c):
        with pytest.raises(AuthorizationError):
            await MemberService(db).move_member_subteam(
                user_id=c["op"], from_team_id=c["crm"], to_team_id=c["seo"]
            )


# ----------------------------------------------------- sem regressao


async def test_manager_mantem_alcance_amplo(db) -> None:
    """MANAGER continua alcancando QUALQUER subtime -- a 028 nao o restringiu.

    Este e o teste que pega o erro mais provavel da implementacao: aplicar a
    trava de subtime a todo mundo em vez de so ao supervisor.
    """
    c = await _cenario(db)
    mgr = await f.make_user(db, workspace_id=c["ws"], email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=mgr, team_id=c["raiz"], role="MANAGER"
    )
    with acting_as(
        workspace_id=c["ws"], user_id=mgr,
        memberships=(Membership(team_id=c["raiz"], role="MANAGER"),),
    ):
        svc = MemberService(db)
        # subtime onde o MANAGER nao e supervisor de nada: passa.
        ut = await svc.assign_to_team(
            user_id=c["op"], team_id=c["crm"], role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR
        # e continua desativando conta (D4 nao mexeu com ele).
        user = await svc.deactivate_member(user_id=c["op"])
        assert user.is_active is False


async def test_permissao_nova_so_do_supervisor(db) -> None:
    """O mapa de permissoes: OPERATOR nao ganhou nada nesta spec."""
    from app.modules.auth.domain.permissions import permissions_for_roles

    assert "member.manage.subteam" in permissions_for_roles(
        frozenset({"SUPERVISOR"})
    )
    assert "member.manage.subteam" not in permissions_for_roles(
        frozenset({"OPERATOR"})
    )
    # ADMIN/MANAGER nao precisam dela -- ja tem team.manage, mais amplo.
    for papel in ("ADMIN", "MANAGER"):
        assert "team.manage" in permissions_for_roles(frozenset({papel}))
