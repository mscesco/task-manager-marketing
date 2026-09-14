"""Spec 045, fatia D -- a rota do papel de ORGANIZACAO, e a trava do ultimo admin.

⚠️⚠️ ESTA ROTA EXISTE PORQUE A INVARIANTE DE NIVEL A EXIGIU. Tirando `ADMIN` do
nivel de time, os dois unicos caminhos que criavam um admin morrem: o
provisionamento (que grava vinculo `user_team`) e o `POST /members` com
`role=ADMIN`. Sem uma rota propria, o sistema ficaria SEM NENHUMA forma de
criar ou promover um administrador ate a Spec 047 trazer as telas.

⚠️ E A TRAVA DO ULTIMO ADMIN NASCE JUNTO, de proposito. A spec pediu essa
invariante na fatia B e eu nao a implementei la -- estava certo por acidente:
sem rota de escrita nao havia como rebaixar ninguem, entao nao havia o que
guardar. Assim que a rota existe, ela passa a ser necessaria **e** possivel.

O que este arquivo prova:

    1. promover alguem a ADMIN de organizacao (sem tocar em time nenhum)
    2. rebaixar funciona quando ha outro admin
    3. ⭐ rebaixar o ULTIMO admin e recusado -- 409
    4. admin INATIVO nao conta para a trava
    5. ⭐⭐ DESATIVAR o ultimo admin tambem e recusado (achado em 10/09) -- o
       caminho que escapava da trava, por um ator sem papel de organizacao
    6. desativar admin passa quando ha outro ativo
    7. desativar quem nao administra a organizacao segue livre
    8. GESTOR pode ser removido livremente (a trava e so do ADMIN)

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.core.tenant import Membership
from app.db.models import User
from app.db.models.enums import OrgRole
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as

pytestmark = pytest.mark.integration


async def _set_org_role(db, user_id, papel: OrgRole | None):
    user = await db.get(User, user_id)
    user.org_role = papel
    await db.flush()


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    dona = await f.make_user(db, workspace_id=ws, email="dona@t.dev")
    await _set_org_role(db, dona, OrgRole.ADMIN)
    return ws, raiz, dona


async def test_promove_alguem_sem_tocar_em_time_nenhum(db) -> None:
    """⭐ O estado que a fatia B tornou normal: autoridade sem vinculo."""
    ws, raiz, dona = await _mundo(db)
    nova = await f.make_user(db, workspace_id=ws, email="nova@t.dev")

    with acting_as(workspace_id=ws, user_id=dona):
        svc = MemberService(db)
        user = await svc.change_organization_role(
            user_id=nova, new_role=OrgRole.GESTOR
        )
        # ⚠️ A LEITURA FICA DENTRO DO `acting_as`, e a primeira versao deste
        # teste a deixou de fora: o repositorio filtra por workspace e EXIGE
        # TenantContext (`BaseRepository._base_select`). Mesma lição que
        # `test_supervisor_remove_do_proprio_subtime` ja registra em
        # comentario -- e eu a repeti.
        vinculos = await svc._users.list_team_memberships(user_id=nova)

    assert user.org_role is OrgRole.GESTOR
    # E ela continua sem time nenhum -- a rota nao encosta em `user_team`.
    assert vinculos == []


async def test_rebaixar_funciona_quando_ha_outro_admin(db) -> None:
    ws, raiz, dona = await _mundo(db)
    segunda = await f.make_user(db, workspace_id=ws, email="segunda@t.dev")
    await _set_org_role(db, segunda, OrgRole.ADMIN)

    with acting_as(workspace_id=ws, user_id=dona):
        user = await MemberService(db).change_organization_role(
            user_id=segunda, new_role=None
        )

    assert user.org_role is None


async def test_rebaixar_o_ULTIMO_admin_e_recusado(db) -> None:
    """⭐ A trava. Sem ela, a organizacao se tranca sozinha.

    ⚠️ O modo de falhar seria irreversivel pela tela: sem nenhum ADMIN, ninguem
    tem `workspace.manage`, e `workspace.manage` e justamente o portao da rota
    que promoveria alguem de volta. A saida seria SQL na mao.

    Sabotagem: remover a chamada a `_assert_nao_e_o_ultimo_admin` faz este
    teste passar direto, e o proximo `change_organization_role` deixaria o
    workspace sem dono.
    """
    ws, raiz, dona = await _mundo(db)

    with acting_as(workspace_id=ws, user_id=dona):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )
        # E rebaixar para GESTOR tambem e rebaixar.
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=OrgRole.GESTOR
            )


async def test_admin_INATIVO_nao_conta_para_a_trava(db) -> None:
    """⚠️ A decisao que so aparece no dia.

    Um admin desativado nao administra nada. Se ele contasse, o ultimo admin
    ATIVO poderia ser rebaixado -- e a organizacao ficaria travada com a cara
    de "estava tudo certo, havia dois".
    """
    ws, raiz, dona = await _mundo(db)
    fantasma = await f.make_user(db, workspace_id=ws, email="fantasma@t.dev")
    await _set_org_role(db, fantasma, OrgRole.ADMIN)
    user = await db.get(User, fantasma)
    user.is_active = False
    await db.flush()

    with acting_as(workspace_id=ws, user_id=dona):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_organization_role(
                user_id=dona, new_role=None
            )


async def test_DESATIVAR_o_ultimo_admin_e_recusado(db) -> None:
    """⭐⭐ O buraco de 10/09, e ele nao passava por admin nenhum.

    Pergunta da Camila: *"e possivel ter alguma organizacao sem nenhum admin?
    nao deveria"*. Era, e o caminho era `deactivate_member`:

        - o gate dela e `team.manage`, que MANAGER tambem tem;
        - a trava do ultimo admin vivia SO em `change_organization_role`;
        - entao um MANAGER de area desativava a conta do unico ADMIN, e a
          organizacao acordava sem ninguem com `workspace.manage`.

    ⚠️ O ATOR AQUI E UM MANAGER DE PROPOSITO, e nao um segundo admin: com um
    admin no comando o teste passaria pela trava de "nao desativar a propria
    conta" e nao provaria nada. O buraco existia justamente para quem NAO tem
    papel de organizacao.

    ⚠️ E a saida seria SQL na mao, como no rebaixamento: sem ADMIN ninguem tem
    `workspace.manage`, que e o portao da rota que promoveria alguem de volta.

    Sabotagem: remover a chamada a `_assert_nao_e_o_ultimo_admin` de
    `deactivate_member` faz este teste passar direto.
    """
    ws, raiz, dona = await _mundo(db)
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).deactivate_member(user_id=dona)

    # E a conta continua ativa -- a recusa nao pode ter passado pela escrita.
    user = await db.get(User, dona)
    assert user.is_active is True
    assert user.org_role is OrgRole.ADMIN


async def test_desativar_admin_passa_quando_ha_outro_ativo(db) -> None:
    """A trava guarda o ULTIMO, e nao o cargo: com dois, desligar um e normal."""
    ws, raiz, dona = await _mundo(db)
    segunda = await f.make_user(db, workspace_id=ws, email="segunda@t.dev")
    await _set_org_role(db, segunda, OrgRole.ADMIN)
    mgr = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=mgr, team_id=raiz, role="MANAGER")

    with acting_as(
        workspace_id=ws,
        user_id=mgr,
        memberships=(Membership(team_id=raiz, role="MANAGER"),),
    ):
        user = await MemberService(db).deactivate_member(user_id=segunda)

    assert user.is_active is False


async def test_desativar_quem_nao_administra_a_organizacao_segue_livre(db) -> None:
    """⚠️ A trava nao pode virar pedagio na desativacao comum.

    A operacao de toda semana e desligar quem saiu da empresa -- gente sem
    papel de organizacao. Se a trava consultasse o contador para todo mundo,
    ela custaria uma query a mais em cada desligamento e, pior, um `409`
    inesperado no dia em que a contagem tivesse qualquer defeito.
    """
    ws, raiz, dona = await _mundo(db)
    saiu = await f.make_user(db, workspace_id=ws, email="saiu@t.dev")
    await f.add_member(db, workspace_id=ws, user_id=saiu, team_id=raiz, role="OPERATOR")

    with acting_as(
        workspace_id=ws,
        user_id=dona,
        memberships=(),
        org_role=OrgRole.ADMIN.value,
    ):
        user = await MemberService(db).deactivate_member(user_id=saiu)

    assert user.is_active is False


async def test_a_trava_e_so_do_admin_gestor_sai_livre(db) -> None:
    """GESTOR opera a organizacao; ele nao e o que a mantem destravada."""
    ws, raiz, dona = await _mundo(db)
    gestor = await f.make_user(db, workspace_id=ws, email="gestor@t.dev")
    await _set_org_role(db, gestor, OrgRole.GESTOR)

    with acting_as(workspace_id=ws, user_id=dona):
        user = await MemberService(db).change_organization_role(
            user_id=gestor, new_role=None
        )

    assert user.org_role is None
