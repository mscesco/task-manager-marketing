"""Spec 047, fatia A -- o cadeado de `GET /members/{id}/teams`.

`can_edit_role` diz, POR VINCULO, se quem esta olhando conseguiria trocar
aquele papel. O painel do membro (fatia D) usa isso para desenhar o cadeado.

⚠️⚠️ ELE EXISTE PARA O FRONT NAO REFAZER A CONTA, e isso e a §3.1 da spec.
A **Spec 034 ja desfez** uma regra de escopo espelhada no front: ela fazia
gestor e admin sumirem dos seletores em tarefa interna de subtime, e foi
**reportado duas vezes, com captura**. A prescricao do briefing e literal --
*"se aparecer necessidade de filtrar escopo no front, falta parametro na
rota"*.

⚠️⚠️ O TESTE QUE MAIS IMPORTA AQUI E O DA CONCORDANCIA, e nao os casos
individuais. Cadeado e PATCH sao duas respostas para a mesma pergunta, e as
duas formas de divergir sao silenciosas:

    cadeado ABERTO + PATCH recusa  -> a pessoa edita, salva e leva 403
    cadeado FECHADO + PATCH aceita -> some da tela uma acao permitida

Nenhuma das duas levanta erro em teste que olhe so um lado.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    return ws, raiz, seo, admin


def _como(ws, user, raiz, seo, papel):
    return acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz if papel != "SUPERVISOR" else seo, papel),),
        team_tree=(node(raiz), node(seo, raiz)),
    )


# ------------------------------------------------------------------
# O cadeado, caso a caso
# ------------------------------------------------------------------
async def test_admin_edita_qualquer_vinculo(db) -> None:
    ws, raiz, seo, admin = await _mundo(db)
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=seo, role="SUPERVISOR"
    )

    with _como(ws, admin, raiz, seo, "ADMIN"):
        svc = MemberService(db)
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=alvo, team_id=seo, papel_atual=UserTeamRole.SUPERVISOR
        )


async def test_ninguem_edita_o_PROPRIO_papel(db) -> None:
    """⭐ C3, o anti-lockout -- e o cadeado tem de mostrar isso.

    ⚠️ Sem este caso, a tela ofereceria a quem e admin a chance de se
    rebaixar, e o 403 chegaria depois do clique. E o cadeado fechado aqui e
    honesto: a operacao E impossivel, nao e falta de permissao.
    """
    ws, raiz, seo, admin = await _mundo(db)

    with _como(ws, admin, raiz, seo, "ADMIN"):
        assert not MemberService(db).pode_trocar_papel_do_vinculo(
            user_id=admin, team_id=raiz, papel_atual=UserTeamRole.ADMIN
        )


async def test_manager_NAO_edita_vinculo_de_manager(db) -> None:
    """A matriz C2: MANAGER so atua sobre SUPERVISOR/OPERATOR."""
    ws, raiz, seo, _admin = await _mundo(db)
    gerente = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=raiz, role="MANAGER"
    )
    par = await f.make_user(db, workspace_id=ws, email="par@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=par, team_id=raiz, role="MANAGER"
    )

    with _como(ws, gerente, raiz, seo, "MANAGER"):
        svc = MemberService(db)
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=par, team_id=raiz, papel_atual=UserTeamRole.MANAGER
        )
        # E o de baixo continua editavel -- sem esta metade, "MANAGER nao
        # edita nada" passaria pelo teste acima.
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=par, team_id=raiz, papel_atual=UserTeamRole.OPERATOR
        )


async def test_supervisor_troca_papel_so_no_proprio_subtime(db) -> None:
    """Spec 049, fatia H: o cadeado ABRE para o supervisor -- no subtime dele.

    ⚠️⚠️ ESTE TESTE SE CHAMAVA `test_supervisor_NAO_troca_papel_de_ninguem` e
    afirmava a D2 da Spec 028 ("trocar papel nao foi aberto ao supervisor").
    A Camila a revogou -- *"supervisor troca o cargo de alguem dentro do seu
    subtime"* (14/09), e rebaixar outro supervisor tambem (15/09).

    ⚠️ AS DUAS METADES SAO O TESTE. So a primeira passaria com o cadeado
    aberto em todo lugar; so a segunda, com ele fechado em todo lugar.
    """
    ws, raiz, seo, _admin = await _mundo(db)
    sup = await f.make_user(db, workspace_id=ws, email="sup@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    operador = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=operador, team_id=seo, role="OPERATOR"
    )
    na_raiz = await f.make_user(db, workspace_id=ws, email="raiz@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=na_raiz, team_id=raiz, role="OPERATOR"
    )

    with _como(ws, sup, raiz, seo, "SUPERVISOR"):
        svc = MemberService(db)
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=operador, team_id=seo, papel_atual=UserTeamRole.OPERATOR
        )
        # A raiz nao e dele: `membership.update` e `_OWN_TEAM_ONLY`.
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=na_raiz, team_id=raiz, papel_atual=UserTeamRole.OPERATOR
        )


# ------------------------------------------------------------------
# ⭐⭐ A concordancia -- o teste que a fatia existe para ter
# ------------------------------------------------------------------
async def test_o_cadeado_concorda_com_o_patch(db) -> None:
    """⭐⭐ O CADEADO E O PATCH RESPONDEM A MESMA PERGUNTA. Aqui se cobra isso.

    Percorre atores e alvos, pergunta ao cadeado e TENTA a operacao de
    verdade. Se o cadeado disse `True`, o PATCH nao pode recusar por
    autorizacao; se disse `False`, tem de recusar.

    ⚠️ E ELE E O UNICO GUARDIAO DA DUPLICACAO. `pode_trocar_papel_do_vinculo`
    reusa as mesmas funcoes que `change_member_role`, mas nada na linguagem
    obriga isso: alguem pode acrescentar um gate ao PATCH e nao acrescentar
    aqui, e os testes caso a caso acima continuariam TODOS verdes -- eles
    olham so um lado.

    ⚠️ SO ERROS DE AUTORIZACAO CONTAM. `BusinessRuleError` (o anti-lockout do
    proprio papel) tambem impede a operacao, e o cadeado ja o reflete; outras
    recusas de regra -- invariante de nivel, posto incoerente -- dependem do
    papel NOVO, que o cadeado deliberadamente nao adivinha (ver a docstring
    dele). Por isso o alvo do PATCH aqui e sempre `OPERATOR`, que cabe nos
    dois niveis e nao dispara nenhuma delas.
    """
    # (papel do ator, papel do alvo). O alvo do PATCH e sempre OPERATOR --
    # ver a docstring.
    casos = [
        (ator, alvo)
        for ator in ("ADMIN", "MANAGER", "SUPERVISOR")
        for alvo in ("OPERATOR", "SUPERVISOR", "MANAGER")
    ]

    for papel_do_ator, papel_do_alvo in casos:
        # ⚠️ MUNDO NOVO A CADA CASO, e nao um mundo reaproveitado: o PATCH que
        # der certo GRAVA, e o caso seguinte encontraria o papel ja trocado --
        # comparando o cadeado com um estado que nao e o que ele leu.
        ws, raiz, seo, admin = await _mundo(db)
        gerente = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
        await f.add_member(
            db, workspace_id=ws, user_id=gerente, team_id=raiz, role="MANAGER"
        )
        sup = await f.make_user(db, workspace_id=ws, email="sup@t.dev")
        await f.add_member(
            db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
        )
        operador = await f.make_user(db, workspace_id=ws, email="op@t.dev")
        await f.add_member(
            db, workspace_id=ws, user_id=operador, team_id=seo, role="OPERATOR"
        )
        await db.flush()

        ator = {"ADMIN": admin, "MANAGER": gerente, "SUPERVISOR": sup}[
            papel_do_ator
        ]
        alvo, time_do_alvo = {
            "OPERATOR": (operador, seo),
            "SUPERVISOR": (sup, seo),
            "MANAGER": (gerente, raiz),
        }[papel_do_alvo]

        with _como(ws, ator, raiz, seo, papel_do_ator):
            svc = MemberService(db)
            cadeado = svc.pode_trocar_papel_do_vinculo(
                user_id=alvo,
                team_id=time_do_alvo,
                papel_atual=UserTeamRole[papel_do_alvo],
            )
            try:
                await svc.change_member_role(
                    user_id=alvo,
                    team_id=time_do_alvo,
                    new_role=UserTeamRole.OPERATOR,
                )
                recusou = False
            except (AuthorizationError, BusinessRuleError):
                recusou = True

        assert cadeado is not recusou, (
            f"cadeado={cadeado} mas PATCH recusou={recusou} "
            f"-- ator {papel_do_ator}, alvo {papel_do_alvo}"
        )
