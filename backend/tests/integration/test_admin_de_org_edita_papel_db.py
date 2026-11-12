"""O ADMIN DE ORGANIZACAO que tambem e OPERATOR num time.

E a forma NORMAL de conta de administracao: quem administra a organizacao nao
precisa de papel de time, e quando tem um, costuma ser o papel de execucao do
proprio trabalho. As duas pertencas convivem, e a de baixo NAO PODE apagar a
de cima.

O que este arquivo prende:
  - o cadeado ABRE para quem administra a organizacao, mesmo com vinculo de
    OPERATOR no time em questao -- inclusive no PROPRIO vinculo, porque a
    autoridade dele nao mora em `user_team` (o anti-lockout continua para quem
    manda so pelo time: `test_cadeado_do_vinculo_db::test_ninguem_edita_o_PROPRIO_papel`);
  - conta desativada nao tem cargo a administrar.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    # ADMIN da ORGANIZACAO, e OPERATOR nos dois times.
    # ⚠️ `org_role` NO BANCO, e nao so no contexto: a trava do ultimo vinculo
    # olha o ALVO (`alvo.org_role`), e o alvo vem do repositorio.
    dona = await f.make_user(
        db, workspace_id=ws, email="dona@t.dev", org_role="ADMIN"
    )
    await f.add_member(db, workspace_id=ws, user_id=dona, team_id=raiz, role="OPERATOR")
    await f.add_member(db, workspace_id=ws, user_id=dona, team_id=sub, role="OPERATOR")

    # A "galera" do subtime.
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=sub, role="OPERATOR")
    sup = await f.make_user(db, workspace_id=ws, email="sup@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=sup, team_id=sub, role="SUPERVISOR")

    await db.flush()
    return ws, raiz, sub, dona, op, sup


def _como_dona(ws, dona, raiz, sub):
    """⚠️ `org_role="ADMIN"` E O PONTO: sem ele, sobram dois vinculos de
    OPERATOR -- e OPERATOR nao administra ninguem, corretamente."""
    return acting_as(
        workspace_id=ws,
        user_id=dona,
        memberships=(mship(raiz, "OPERATOR"), mship(sub, "OPERATOR")),
        team_tree=(node(raiz), node(sub, raiz)),
        org_role="ADMIN",
    )


async def test_admin_de_org_com_vinculo_de_operator_abre_o_cadeado(db):
    """O cadeado tem de ABRIR."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=op, team_id=sub, papel_atual=UserTeamRole.OPERATOR
        ), "admin da organizacao nao consegue editar operador do subtime"
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=sup, team_id=sub, papel_atual=UserTeamRole.SUPERVISOR
        ), "admin da organizacao nao consegue editar supervisor do subtime"


async def test_o_patch_concorda_com_o_cadeado(db):
    """⚠️⚠️ As duas respostas para a mesma pergunta: cadeado aberto que da 403
    ao salvar e defeito silencioso."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        vinculo = await svc.change_member_role(
            user_id=op, team_id=sub, new_role=UserTeamRole.SUPERVISOR
        )
        assert vinculo.role == UserTeamRole.SUPERVISOR


async def test_sem_papel_de_organizacao_o_operator_nao_administra_ninguem(db):
    """⚠️ O contraste que prova que o teste acima nao passa por acidente."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with acting_as(
        workspace_id=ws,
        user_id=dona,
        memberships=(mship(raiz, "OPERATOR"), mship(sub, "OPERATOR")),
        team_tree=(node(raiz), node(sub, raiz)),
    ):
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=op, team_id=sub, papel_atual=UserTeamRole.OPERATOR
        )


async def test_a_listagem_por_time_traz_o_cadeado_de_cada_um(db):
    """⚠️ A tela NAO pode deduzir o cadeado: a gaveta do subtime lista as
    pessoas com o cargo e precisa saber quais deles pode oferecer para editar.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        linhas = await svc.list_team_members(team_id=sub)
        por_user = {v.user_id: v for v, _ in linhas}

    # As tres pessoas do subtime, e ninguem da raiz.
    assert set(por_user) == {dona, op, sup}

    with _como_dona(ws, dona, raiz, sub):
        cadeados = {
            v.user_id: svc.pode_trocar_papel_do_vinculo(
                user_id=v.user_id, team_id=sub, papel_atual=v.role, alvo_ativo=ativo
            )
            for v, ativo in linhas
        }
    assert cadeados[op] is True
    assert cadeados[sup] is True
    # ⚠️ E o PROPRIO vinculo tambem abre: quem olha manda pela organizacao.
    assert cadeados[dona] is True


async def test_conta_desativada_nao_tem_cargo_a_administrar(db):
    """⚠️ A trava e do SERVIDOR. Desativar desliga a pessoa do sistema
    INTEIRO: promover ou rebaixar uma conta desativada escreve um estado sem
    efeito -- e que MENTE para quem administra.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        await svc.deactivate_member(user_id=op)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        # O cadeado FECHA.
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=op,
            team_id=sub,
            papel_atual=UserTeamRole.OPERATOR,
            alvo_ativo=False,
        )
        # E o PATCH recusa, mesmo que alguem chame a rota direto.
        with pytest.raises(BusinessRuleError):
            await svc.change_member_role(
                user_id=op, team_id=sub, new_role=UserTeamRole.SUPERVISOR
            )


async def test_desativado_nao_entra_em_time_novo(db):
    """⚠️ A mesma regra na outra porta: vincular tambem nao produz efeito."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    outro = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        await svc.deactivate_member(user_id=op)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=op, team_id=outro, role=UserTeamRole.OPERATOR
            )


async def test_tirar_do_time_CONTINUA_permitido(db):
    """⚠️⚠️ A EXCECAO, e ela e deliberada: remover e a operacao de LIMPEZA de
    quem saiu da empresa. Barra-la deixaria o vinculo morto preso para sempre.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    # ⚠️ `op` ganha um SEGUNDO vínculo: a regra anti-órfão ("ele ficaria sem
    # time") é outra, e é ela que barraria a remoção aqui — não a desativação.
    # Sem esta linha o teste passaria a afirmar a regra errada.
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=raiz, role="OPERATOR")
    await db.flush()

    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        await svc.deactivate_member(user_id=op)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        await svc.remove_member_from_team(user_id=op, team_id=sub)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        restantes = await svc.list_team_members(team_id=sub)
    assert op not in {v.user_id for v, _ in restantes}


async def test_a_listagem_por_time_diz_quem_esta_inativo(db):
    """⚠️ A tela precisa distinguir DUAS razoes para o cadeado fechado: "fora
    do seu escopo" e "esta pessoa foi desativada"."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        await svc.deactivate_member(user_id=op)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        linhas = await svc.list_team_members(team_id=sub)
    ativos = {v.user_id: ativo for v, ativo in linhas}
    assert ativos[op] is False
    assert ativos[sup] is True


async def test_quem_manda_pela_organizacao_mexe_no_PROPRIO_vinculo(db):
    """⚠️ O anti-lockout existe contra quem se TRANCA PARA FORA: rebaixar o
    proprio papel de time era perder a autoridade que permitia desfazer. Quem
    tem papel de ORGANIZACAO nao passa por isso -- a autoridade dele nao mora
    em `user_team`, entao a operacao e sempre reversivel.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        # O cadeado ABRE no proprio vinculo.
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=dona, team_id=sub, papel_atual=UserTeamRole.OPERATOR
        )
        # ⚠️ E o SERVIDOR ACEITA: ela se tira do proprio subtime.
        #
        # ⚠️ O ALVO E A REMOCAO, e nao uma promocao, de proposito: promover a
        # si mesma esbarraria em OUTRAS regras (nivel do papel, comando na
        # raiz) e o teste passaria a afirmar aquelas, e nao o anti-lockout.
        await svc.remove_member_from_team(user_id=dona, team_id=sub)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        restantes = await svc.list_member_teams(user_id=dona)
    assert {v.team_id for v in restantes} == {raiz}


async def test_quem_tem_papel_de_organizacao_pode_ficar_SEM_TIME(db):
    """⚠️ A outra metade: a trava do ULTIMO vinculo tambem nao vale para ela.

    "Sem time" nao e orfa para quem administra a organizacao: e o estado
    normal da conta de administracao.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        await svc.remove_member_from_team(user_id=dona, team_id=sub)
        await svc.remove_member_from_team(user_id=dona, team_id=raiz)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        restantes = await svc.list_member_teams(user_id=dona)
    assert restantes == []
