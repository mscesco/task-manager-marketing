"""Spec 045, fatia D (§4.4) -- comando na raiz nao acumula vinculo de subtime.

Levantada pela Camila em 02/09, sobre o proprio cadastro:

    *"estou no projeto como operadora do crm que e subtime de marketing e
    manager do marketing (...) isso nao pode acontecer, e meio que para
    herdar a mesma permissao"*

MANAGER na raiz JA significa gerente de todos os subtimes dela. O vinculo de
subtime nao acrescenta alcance nenhum, e afirma no organograma algo falso --
que a pessoa "esta em" um braco especifico.

⚠️ A REGRA SO E ACEITAVEL PORQUE A SPEC 034 EXISTE: gestor e admin aparecem
nos seletores de subtime SEM vinculo la. Sem isso, esta trava tiraria gente
dos seletores e seria revogada em uma semana.

⚠️⚠️ AS PORTAS CHEGAM AO MESMO ESTADO POR CAMINHOS DIFERENTES, e a segunda
e a que ninguem lembra:

    assign_to_team      -- adiciona a gerente a um subtime      (obvio)
    change_member_role  -- PROMOVE na raiz quem ja tem subtime  (NAO obvio:
                           a operacao nao menciona subtime nenhum)

(Havia uma terceira, `move_member_subteam`, que saiu com a rota em 17/09/2026.)

⚠️⚠️ ESTE ARQUIVO NAO PROVA A PARTE MAIS FACIL DE ERRAR DA REGRA, e isso e
deliberado: "comando **nesta** arvore" versus "comando em qualquer lugar" so
se distingue com DUAS raizes, e o indice parcial da migration `0004` so deixa
existir uma por workspace ate a Spec 046. Esse guardiao esta em
`tests/test_comando_sem_subtime.py`, com a arvore montada em memoria. Se
voce esta aqui procurando o teste da segunda arvore, e la.

⚠️ E O CADASTRO VELHO CONTINUA LA. Trava de escrita nao conserta linha que ja
existe -- mesma limitacao da Spec 044 §4.1-bis. A varredura de 02/09 achou um
registro; ele saiu a mao antes desta fatia subir.

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
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    social = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="social"
    )
    admin = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    # ⚠️ VINCULO ADMIN NO ATOR, e nao `org_role`: `acting_as` deriva as
    # permissoes das memberships e nao aceita papel de organizacao -- nem
    # `tenant_scope` o repassa. E uma lacuna da fatia C que so aparece em
    # teste; a fonte velha continua valendo em `is_admin`, entao o ator fica
    # assim ate alguem fechar essa lacuna.
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=marketing, role="ADMIN"
    )
    alvo = await f.make_user(db, workspace_id=ws, email="alvo@t.dev")
    await db.flush()
    return ws, marketing, seo, social, admin, alvo


def _como_admin(ws, marketing, admin):
    return acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(Membership(team_id=marketing, role="ADMIN"),),
    )


# ------------------------------------------------------------------
# As portas
# ------------------------------------------------------------------
async def test_manager_da_raiz_nao_entra_em_subtime_dela(db) -> None:
    """⭐ Porta 2 (`assign_to_team`) -- o caso exato que a Camila descreveu."""
    ws, marketing, seo, social, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=marketing, role="MANAGER"
    )

    with _como_admin(ws, marketing, admin):
        with pytest.raises(BusinessRuleError) as exc:
            await MemberService(db).assign_to_team(
                user_id=alvo, team_id=seo, role=UserTeamRole.OPERATOR
            )

    # A mensagem EXPLICA, e nao so barra (requisito da §4.4): quem tenta isso
    # esta resolvendo um problema real ("ela precisa ver isso"), e a resposta
    # util e que ela ja ve.
    assert "alcancam todos os subtimes" in str(exc.value)


async def test_promover_na_raiz_quem_ja_tem_subtime_e_recusado(db) -> None:
    """⭐⭐ Porta 3 (`change_member_role`) -- o caminho que ninguem lembra.

    Ninguem adiciona ninguem a subtime nenhum aqui. O vinculo de subtime ja
    existe, e e a PROMOCAO na raiz que cria o acumulo -- numa operacao que
    nao menciona subtime em lugar algum.

    Sabotagem: tirar a chamada desta porta deixa os outros dois testes verdes
    e abre um caminho completo para o estado proibido.
    """
    ws, marketing, seo, social, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=marketing, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR"
    )

    with _como_admin(ws, marketing, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=alvo, team_id=marketing, new_role=UserTeamRole.MANAGER
            )


# ------------------------------------------------------------------
# O que a regra NAO barra -- e cada um destes seria um bug de produto
# ------------------------------------------------------------------
async def test_operator_da_raiz_entra_em_subtime_normalmente(db) -> None:
    """OPERATOR nao e comando: nao alcanca subtime nenhum por autoridade.

    ⚠️ Este e o cadastro NORMAL do produto -- alguem do geral que tambem
    trabalha num braco. Barra-lo esvaziaria os subtimes.

    ⚠️⚠️ O PAPEL NO SUBTIME E `OPERATOR`, E ISSO NAO E DETALHE. A primeira
    versao deste teste usava SUPERVISOR e falhou -- por causa da REGRA IRMA,
    nao desta: `OPERATOR@raiz + SUPERVISOR@sub` e exatamente a inversao que a
    Spec 044 fatia 5 mata ("o papel na raiz nao pode ser menor"). O teste
    passaria a medir as duas travas somadas e denunciaria a errada.
    """
    ws, marketing, seo, social, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=marketing, role="OPERATOR"
    )

    with _como_admin(ws, marketing, admin):
        vinculo = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.OPERATOR
        )

    assert vinculo.role == UserTeamRole.OPERATOR


async def test_sem_vinculo_na_raiz_o_subtime_passa(db) -> None:
    """⚠️ O cadastro mais comum de todos: supervisor de subtime que nunca foi
    cadastrado na raiz. Tratar ausencia como comando barraria todo mundo."""
    ws, marketing, seo, social, admin, alvo = await _mundo(db)

    with _como_admin(ws, marketing, admin):
        vinculo = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=seo, role=UserTeamRole.SUPERVISOR
        )

    assert vinculo.team_id == seo


async def test_dois_subtimes_sem_vinculo_na_raiz_continua_passando(db) -> None:
    """A Spec 044 fatia 3 derrubou a trava de um subtime por pessoa -- esta
    regra nao pode reintroduzi-la pela porta dos fundos."""
    ws, marketing, seo, social, admin, alvo = await _mundo(db)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo, team_id=seo, role="OPERATOR"
    )

    with _como_admin(ws, marketing, admin):
        vinculo = await MemberService(db).assign_to_team(
            user_id=alvo, team_id=social, role=UserTeamRole.OPERATOR
        )

    assert vinculo.team_id == social
