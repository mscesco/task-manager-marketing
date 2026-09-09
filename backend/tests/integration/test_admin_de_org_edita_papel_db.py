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
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    # A conta dela: ADMIN da ORGANIZACAO, e OPERATOR nos dois times.
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
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


async def test_o_proprio_vinculo_continua_fechado(db):
    """⚠️ O UNICO cadeado fechado que ela deve ver -- anti-lockout (C3)."""
    ws, raiz, sub, dona, op, sup = await _mundo(db)
    svc = MemberService(db)
    with _como_dona(ws, dona, raiz, sub):
        assert not svc.pode_trocar_papel_do_vinculo(
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
