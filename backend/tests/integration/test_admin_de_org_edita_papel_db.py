"""O ADMIN DE ORGANIZACAO que tambem e OPERATOR num time -- 09/09.

⚠️⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO RELATADO NA TELA: *"nao estou
conseguindo mudar as permissoes da galera, mesmo sendo admin do espaco e
operator do subtime"*. A conta da Camila tem `org_role = ADMIN` e vinculos de
OPERATOR -- e essa combinacao nao tinha teste nenhum.

Ela e a forma NORMAL depois da Spec 045 (fatia B): quem administra a
organizacao nao precisa de papel de time, e quando tem um, costuma ser o papel
de execucao do proprio trabalho. As duas pertencas convivem, e a de baixo NAO
PODE apagar a de cima.

O que este arquivo prende:
  - o cadeado ABRE para quem administra a organizacao, mesmo com vinculo de
    OPERATOR no time em questao;
  - e continua FECHADO no proprio vinculo (anti-lockout da C3), que e o unico
    cadeado que a Camila deve ver fechado.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
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

    # A conta dela: ADMIN da ORGANIZACAO, e OPERATOR nos dois times.
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
    """⭐⭐ O caso relatado. O cadeado tem de ABRIR."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=op, team_id=sub, papel_atual=UserTeamRole.OPERATOR
        ), "admin da organizacao nao consegue editar operador do subtime"
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=sup, team_id=sub, papel_atual=UserTeamRole.SUPERVISOR
        ), "admin da organizacao nao consegue editar supervisor do subtime"


async def test_o_proprio_vinculo_ABRE_para_quem_manda_pela_organizacao(db):
    """⚠️⚠️ ESTE TESTE AFIRMAVA O CONTRARIO ate 10/09 ("o proprio vinculo
    continua fechado"), e a inversao e uma DECISAO, nao um conserto.

    A pergunta veio dela: *"eu realmente nao posso mudar meu cargo dentro dos
    times? sou admin da organizacao, se eu me tirar de um time nao deveria ter
    problema pois posso me colocar de volta, nao?"*. A C3 protege contra quem
    se tranca para fora -- e quem manda pela ORGANIZACAO nao se tranca, porque
    a autoridade dele nao mora em `user_team`.

    Ver `test_SEM_papel_de_organizacao_a_trava_continua` para o contraste.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        assert svc.pode_trocar_papel_do_vinculo(
            user_id=dona, team_id=sub, papel_atual=UserTeamRole.OPERATOR
        )


async def test_o_patch_concorda_com_o_cadeado(db):
    """⚠️⚠️ As duas respostas para a mesma pergunta. Cadeado aberto que da 403
    ao salvar e o defeito silencioso que a fatia A existe para impedir."""
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
    """⭐⭐ A rota que a gaveta do subtime precisava -- 09/09.

    ⚠️ Ela existe porque a tela NAO pode deduzir o cadeado. A gaveta do subtime
    lista as pessoas com o cargo, e ate agora nao tinha como saber quais desses
    cargos ela podia oferecer para editar -- entao nao oferecia nenhum.
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
    # ⚠️ E o PROPRIO vinculo tambem abre, desde 10/09: ela manda pela
    # organizacao. Ver `test_o_proprio_vinculo_ABRE_...`.
    assert cadeados[dona] is True


async def test_conta_desativada_nao_tem_cargo_a_administrar(db):
    """⭐⭐ Relatado na tela em 10/09, e a trava faltava NO SERVIDOR.

    *"Kaua ta inativo e aparecendo na lista de membros do subtime e ainda
    consigo fazer alteracoes com alguem desativado ????? ta doido"*.

    ⚠️ Desativar desliga a pessoa do sistema INTEIRO, e nao ha rota de reativar
    (D5 da Spec 028). Promover ou rebaixar uma conta desativada escreve um
    estado sem efeito -- e que MENTE para quem administra: "supervisor de SEO"
    numa conta que ninguem usa.
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


async def test_ADMIN_nao_e_papel_de_time(db):
    """⚠️⚠️ A Camila achou um "Administrador" como cargo de TIME no Marketing:
    *"por algum motivo e permitido ter um administrador no time do marketing"*.

    Este teste responde a pergunta que importa: o servidor ainda ACEITA criar
    um? Nao -- a invariante de nivel da Spec 045 (fatia D) recusa ADMIN em
    nivel de time, nas duas portas. Ou seja, a linha que ela viu e RESIDUO DE
    DADO, anterior aquela spec, e nao um gate aberto.

    ⚠️ O residuo nao some sozinho: `user_team` guarda o que gravaram antes da
    regra existir, e nenhuma migration o reescreveu. E limpeza de DADO.
    """
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    novo = await f.make_user(db, workspace_id=ws, email="novo@t.dev")
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        # Porta 1: vincular ja como ADMIN.
        with pytest.raises((BusinessRuleError, ValueError)):
            await svc.assign_to_team(
                user_id=novo, team_id=raiz, role=UserTeamRole.ADMIN
            )
        # Porta 2: promover a ADMIN um vinculo que existe.
        with pytest.raises((BusinessRuleError, ValueError)):
            await svc.change_member_role(
                user_id=op, team_id=sub, new_role=UserTeamRole.ADMIN
            )


async def test_quem_manda_pela_organizacao_mexe_no_PROPRIO_vinculo(db):
    """⭐⭐ A pergunta da Camila em 10/09, e ela estava certa.

    *"eu realmente nao posso mudar meu cargo dentro dos times? sou admin da
    organizacao, se eu me tirar de um time nao deveria ter problema pois posso
    me colocar de volta, nao?"*

    ⚠️ A C3 (anti-lockout) nasceu contra quem se TRANCA PARA FORA: rebaixar o
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
        # ⚠️ E o SERVIDOR ACEITA: ela se tira do proprio subtime, que e
        # exatamente o que ela tentou fazer na tela.
        #
        # ⚠️ O ALVO E A REMOCAO, e nao uma promocao, de proposito: promover a
        # si mesma esbarraria em OUTRAS regras (a §4.1-bis da Spec 044, ou a
        # §4.4 do comando na raiz) e o teste passaria a afirmar aquelas, e nao
        # o anti-lockout. Cada teste prende UMA regra.
        await svc.remove_member_from_team(user_id=dona, team_id=sub)
    await db.flush()

    with _como_dona(ws, dona, raiz, sub):
        restantes = await svc.list_member_teams(user_id=dona)
    assert {v.team_id for v in restantes} == {raiz}


async def test_SEM_papel_de_organizacao_a_trava_continua(db):
    """⚠️⚠️ O CONTRASTE, e ele e o que torna a abertura segura: um MANAGER que
    se rebaixa perde `team.manage` e NAO volta sozinho. Para ele, a C3 segue
    sendo a rede."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    gerente = await f.make_user(db, workspace_id=ws, email="ger@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=raiz, role="MANAGER"
    )
    await db.flush()

    svc = MemberService(db)
    with acting_as(
        workspace_id=ws,
        user_id=gerente,
        memberships=(mship(raiz, "MANAGER"),),
        team_tree=(node(raiz), node(sub, raiz)),
    ):
        assert not svc.pode_trocar_papel_do_vinculo(
            user_id=gerente, team_id=raiz, papel_atual=UserTeamRole.MANAGER
        )
        with pytest.raises(BusinessRuleError):
            await svc.change_member_role(
                user_id=gerente, team_id=raiz, new_role=UserTeamRole.OPERATOR
            )


async def test_quem_tem_papel_de_organizacao_pode_ficar_SEM_TIME(db):
    """⚠️ A outra metade: a trava do ULTIMO vinculo tambem nao vale para ela.

    "Sem time" nao e orfa para quem administra a organizacao -- e o estado
    normal desde a Spec 045 (fatia B), e e como a conta de administracao da
    Camila vive desde 08/09.
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


async def test_o_ultimo_vinculo_de_quem_NAO_tem_org_continua_travado(db):
    """⚠️ O contraste da regra acima: sem papel de organizacao, ficar sem time
    e ficar sem acesso a nada -- e a Spec 014 existiu para eliminar isso."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        with pytest.raises(BusinessRuleError):
            # `op` so tem o vinculo do subtime.
            await svc.remove_member_from_team(user_id=op, team_id=sub)
