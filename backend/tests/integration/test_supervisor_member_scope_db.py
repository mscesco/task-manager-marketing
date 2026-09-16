"""Spec 028 -- SUPERVISOR administra OPERATOR do PROPRIO subtime.

Ate esta spec, so ADMIN/MANAGER chegavam ao MemberService: as rotas exigiam
`team.manage`. A 028 abriu DUAS rotas (adicionar / remover) para a permissao
nova `member.manage.subteam` -- e com isso o SUPERVISOR passou a alcancar o
service. A matriz C2 (Spec 015) sozinha NAO o barra: ela so recusa alvo
MANAGER/ADMIN, entao supervisor mexendo em OPERATOR passaria direto.

O que este arquivo prova, em ordem de importancia:

    D1  supervisor NAO alcanca outro subtime      <- a trava inegociavel
    H   supervisor cria, troca e tira par SUPERVISOR no proprio subtime
        (era a D2, "so mexe em OPERATOR" -- revogada pela Camila na Spec 049,
        fatia H; os tres testes do bloco mudaram de lado de proposito)
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
from app.shared.exceptions.base import AuthorizationError, BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

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
        # ⚠️⚠️ A ARVORE E OBRIGATORIA NESTE ARQUIVO desde a Spec 049, fatia B.
        # A trava D1 deixou de recalcular "onde sou supervisor" a mao e passou
        # a perguntar a permissao COM ESCOPO -- e sem `team_tree` o `acting_as`
        # monta um `frozenset`, com o qual `has_permission_in` responde a
        # pergunta AMPLA. Os testes de D1 ficariam verdes com a trava errada.
        "arvore": (node(raiz), node(seo, raiz), node(crm, raiz)),
    }


def _como_supervisor(c, *, subtime_key="seo", ator_key="sup_seo"):
    return acting_as(
        workspace_id=c["ws"],
        user_id=c[ator_key],
        memberships=(Membership(team_id=c[subtime_key], role="SUPERVISOR"),),
        team_tree=c["arvore"],
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


# ----------------------------------------------------------------- H (era D2)
#
# ⚠️⚠️ OS TRES TESTES DESTE BLOCO AFIRMAVAM O CONTRARIO ate a Spec 049, fatia H.
# Eram a prova da D2 da Spec 028 -- "supervisor nao promove; criar outro
# SUPERVISOR e trabalho do MANAGER". A Camila a revogou: *"supervisor troca o
# cargo de alguem dentro do seu subtime"* (14/09), e sobre rebaixar outro
# supervisor, *"Sim, pode rebaixar, qualquer coisa o gerente arruma ne"*
# (15/09). Nao e trava afrouxada por engano: e decisao, e o que continua
# travado esta nas metades negativas de cada teste.
#
# ⚠️ O ALVO NAO ESTA NA RAIZ, e e de proposito: OPERATOR na raiz promovido a
# SUPERVISOR no subtime esbarra em "o papel no time principal nao pode ser
# menor" (409), e o teste mediria essa regra em vez da permissao.


async def _operador_do_crm(db, c, email: str):
    uid = await f.make_user(db, workspace_id=c["ws"], email=email)
    await f.add_member(
        db, workspace_id=c["ws"], user_id=uid, team_id=c["crm"], role="OPERATOR"
    )
    return uid


async def test_supervisor_atribui_supervisor_no_proprio_subtime(db) -> None:
    """Fatia H: o supervisor cria par -- no subtime dele, e so ate supervisor."""
    c = await _cenario(db)
    pessoa = await _operador_do_crm(db, c, "pessoa@t.dev")
    with _como_supervisor(c):
        svc = MemberService(db)
        ut = await svc.assign_to_team(
            user_id=pessoa, team_id=c["seo"], role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR
        # O teto que sobra e o NIVEL: gerente nao existe em subtime, e o
        # supervisor so alcanca subtime. ⚠️ Ate a Spec 051 (fatia C) quem barrava
        # era a matriz C2 (403); ela passou a deixar gestor e gerente darem
        # MANAGER, e a recusa do supervisor ficou com a regra que a explica.
        outra = await _operador_do_crm(db, c, "outra@t.dev")
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outra, team_id=c["seo"], role=UserTeamRole.MANAGER
            )


async def test_supervisor_troca_papel_no_proprio_subtime(db) -> None:
    """Fatia H: promove e rebaixa no subtime dele; fora dele, 403 (D1)."""
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
        # ⭐ E rebaixa um par -- a pergunta 5 da spec, respondida "sim".
        rebaixado = await svc.change_member_role(
            user_id=pessoa, team_id=c["seo"], new_role=UserTeamRole.OPERATOR
        )
        assert rebaixado.role == UserTeamRole.OPERATOR
        # D1: o vinculo do CRM nao e dele.
        with pytest.raises(AuthorizationError):
            await svc.change_member_role(
                user_id=pessoa, team_id=c["crm"], new_role=UserTeamRole.SUPERVISOR
            )


async def test_supervisor_remove_par_supervisor(db) -> None:
    """Fatia H no caminho destrutivo: o outro supervisor do subtime sai.

    Cobre o caso em que dois supervisores dividem o mesmo subtime.
    """
    c = await _cenario(db)
    outro_sup = await _operador_do_crm(db, c, "sup2@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=outro_sup,
        team_id=c["seo"], role="SUPERVISOR",
    )
    with _como_supervisor(c):
        svc = MemberService(db)
        await svc.remove_member_from_team(user_id=outro_sup, team_id=c["seo"])
        restantes = {
            ut.team_id for ut in await svc.list_member_teams(user_id=outro_sup)
        }
    assert restantes == {c["crm"]}


async def test_supervisor_nao_mexe_em_manager_nem_admin(db) -> None:
    """Criterio 5 da spec: alvo MANAGER/ADMIN -> 403.

    ⚠️ Ate a Spec 049, fatia H, quem barrava era a trava "so OPERATOR" (a D2),
    que saiu. Hoje barram duas outras, e este teste e o que prova que sobrou
    alguma: gerente e admin moram na RAIZ, onde o supervisor nao tem
    `membership.delete` (D1), e a matriz C2 recusa o alvo.
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
        team_tree=c["arvore"],
    ):
        svc = MemberService(db)
        # subtime onde o MANAGER nao e supervisor de nada: passa.
        #
        # ⚠️ O ALVO NAO E MAIS O `op` DO CENARIO, e a troca e da Spec 044 fatia
        # 5: `op` e OPERATOR na RAIZ, e promove-lo a SUPERVISOR de subtime cria
        # a inversao que a regra da Camila proibe (papel na raiz menor que no
        # subtime). O que este teste prova -- que o MANAGER alcanca subtime
        # onde nao supervisiona -- nao depende do papel do alvo na raiz.
        novo = await f.make_user(db, workspace_id=c["ws"], email="novo@t.dev")
        # ⚠️ Spec 051, fatia C: e com vinculo NA ARVORE (o SEO) -- quem nao e da
        # organizacao so vincula quem ja esta nela. Sem time nenhum, so a
        # organizacao.
        await f.add_member(
            db, workspace_id=c["ws"], user_id=novo, team_id=c["seo"], role="OPERATOR"
        )
        ut = await svc.assign_to_team(
            user_id=novo, team_id=c["crm"], role=UserTeamRole.SUPERVISOR
        )
        assert ut.role == UserTeamRole.SUPERVISOR
        # e continua desativando conta (D4 nao mexeu com ele).
        user = await svc.deactivate_member(user_id=c["op"])
        assert user.is_active is False


async def test_papeis_divergentes_o_escopo_segue_o_vinculo(db) -> None:
    """⭐ Spec 044, fatia 3: SUPERVISOR em SEO + OPERATOR em CRM.

    ⚠️ ESTE CASO ERA IMPOSSIVEL DE CADASTRAR ate esta fatia -- estar em dois
    subtimes era 422. Por isso ele nunca teve teste, e por isso ele entra
    aqui agora que a trava saiu.

    A ADR 0039 listou "papel efetivo quando os papeis divergem" como pergunta
    ABERTA. Nao e: a Spec 028 ja respondeu em codigo, vinculo a vinculo. Este
    teste existe para que a resposta CONTINUE sendo essa: a pessoa administra
    onde e supervisora, e so ali, mesmo tendo `membership.create` pela uniao
    dos papeis (que ignora o time, de proposito).

    ⚠️ QUEM RESPONDE MUDOU na Spec 049, fatia B: era `_subtimes_supervisionados`
    (filtro `role == SUPERVISOR`, recalculado a mao); hoje e
    `permissions_for_actor`, que concede `membership.*` ao papel de execucao so
    no time DAQUELE vinculo (`_OWN_TEAM_ONLY`). O OPERATOR do CRM nao tem
    `membership.create` nenhum -- entao o CRM nao entra.

    Sabotagem: tirar `membership.create` de `_OWN_TEAM_ONLY` NAO derruba este
    teste (o OPERATOR nao tem o verbo em lugar nenhum); o que derruba e dar
    `membership.create` ao OPERATOR no mapa -- o segundo bloco passa.
    """
    c = await _cenario(db)

    # A pessoa nasce supervisora do SEO e ganha, PELO SERVICO, um vinculo de
    # OPERATOR no CRM -- o que a trava recusava.
    admin = await f.make_user(db, workspace_id=c["ws"], email="adm@t.dev")
    await f.add_member(
        db, workspace_id=c["ws"], user_id=admin, team_id=c["raiz"], role="ADMIN"
    )
    with acting_as(
        workspace_id=c["ws"], user_id=admin,
        memberships=(Membership(team_id=c["raiz"], role="ADMIN"),),
        team_tree=c["arvore"],
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


async def test_quem_administra_membro_de_subtime_no_mapa(db) -> None:
    """⭐ Spec 045, fatia A: o mapa passa a dizer a verdade.

    ⚠️⚠️ ESTE TESTE SE CHAMAVA `test_permissao_nova_so_do_supervisor` E O "SO"
    ERA FALSO. `member.manage.subteam` existia apenas no SUPERVISOR, e o mapa
    -- o documento que diz quem pode o que -- afirmava que ADMIN e MANAGER nao
    administram membro de subtime. Eles administram desde a Spec 028, por um
    *early return* em `_assert_escopo_supervisor`. A versao antiga deste teste
    ate encostava nisso: dizia, num comentario, que "ADMIN/MANAGER nao precisam
    dela", e checava `team.manage` no lugar.

    Decisao da Camila (02/09): *"manager e admin administram absolutamente tudo
    do time e sua arvore inteira"*. A permissao foi para o mapa.

    ⚠️ O QUE ISTO NAO MUDA: o ESCOPO. Continua sendo o servico quem diz "onde",
    e para ADMIN/MANAGER o "onde" e a arvore deles -- nao os subtimes que
    supervisionam. Os testes de escopo deste arquivo sao a contraprova disso.
    """
    from app.modules.auth.domain.permissions import permissions_for_roles

    # Os tres papeis de comando e supervisao a tem; o OPERATOR nao.
    for papel in ("ADMIN", "MANAGER", "SUPERVISOR"):
        assert "membership.create" in permissions_for_roles(
            frozenset({papel})
        ), f"{papel} deveria administrar membro de subtime pelo MAPA"
    assert "membership.create" not in permissions_for_roles(
        frozenset({"OPERATOR"})
    )

    # ⚠️ E A NAO-MONOTONICIDADE MORREU AQUI. Enquanto `member.manage.subteam`
    # existia so no SUPERVISOR, `MANAGER@raiz + SUPERVISOR@sub` ganhava uma
    # permissao vinda de BAIXO (Spec 044, §4.1-bis). Agora a uniao dos dois
    # papeis nao acrescenta nada ao que o MANAGER ja tinha sozinho.
    so_manager = permissions_for_roles(frozenset({"MANAGER"}))
    com_supervisor = permissions_for_roles(frozenset({"MANAGER", "SUPERVISOR"}))
    assert com_supervisor - so_manager == frozenset()
