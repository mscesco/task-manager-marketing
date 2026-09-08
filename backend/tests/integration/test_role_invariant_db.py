"""Invariante de papel por nivel de time -- integracao (Spec 024).

A regra e ASSIMETRICA: ADMIN/MANAGER so na raiz; a raiz aceita os quatro
papeis (estar so no time geral e estado valido -- Spec 003, dec. 7 e 17).

Cobre os criterios de aceite 1-11 ponta a ponta:
    1-2  create_member com papel fora do nivel
    3    assign_to_team com papel fora do nivel
    4    change_member_role promovendo em subtime
    5    move_member_subteam levando o papel pro nivel errado
    6-7  TeamService.create/move -> 409 de dominio, NUNCA IntegrityError
    8    workspace nunca fica sem raiz (ciclo continua barrando)
    9    provisionamento/seed rodam limpos sob a invariante
    10   indice unico recusa segunda raiz no banco
    11   isolamento de tenant (raiz do A nao conflita com a do B)

O criterio 6-7 e o motivo principal desta suite: sem os guards de dominio,
o indice da Fatia 1 transforma essas rotas em HTTP 500.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)
from app.modules.workspaces.application.workspace_service import TeamService
from app.shared.exceptions.base import BusinessRuleError, ConflictError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Workspace com raiz + um subtime + um ADMIN na raiz."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")
    admin = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )
    return ws, raiz, sub, admin


def _como_admin(ws, raiz, sub, admin):
    return acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz), node(sub, raiz)),
    )


def _cmd(team_id: uuid.UUID, role: UserTeamRole) -> CreateMemberCommand:
    return CreateMemberCommand(
        name="Fulano de Teste",
        email=f"fulano-{uuid.uuid4().hex[:8]}@teste.dev",
        team_id=team_id,
        role=role,
    )


# ------------------------------------------------------------------
# 1-2. create_member
# ------------------------------------------------------------------
@pytest.mark.parametrize("role", [UserTeamRole.ADMIN, UserTeamRole.MANAGER])
async def test_create_member_recusa_admin_manager_em_subtime(db, role) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).create_member(_cmd(sub, role))

    # nada gravado
    total = (
        await db.execute(
            text("SELECT count(*) FROM user_team WHERE team_id=:t"), {"t": sub}
        )
    ).scalar_one()
    assert total == 0


async def test_create_member_aceita_operator_na_raiz(db) -> None:
    """Membro "do geral", sem subtime: estado projetado (Spec 003, dec. 7).

    ⚠️ ERA PARAMETRIZADO COM SUPERVISOR TAMBEM, e a Spec 045 fatia D tirou:
    supervisor deixou de caber na raiz. O caso do OPERATOR e o que sustenta o
    estado projetado, e ele fica intacto.
    """
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        criado = await MemberService(db).create_member(
            _cmd(raiz, UserTeamRole.OPERATOR)
        )
    assert criado.user.id is not None


async def test_create_member_recusa_supervisor_na_raiz(db) -> None:
    """⭐ Spec 045, fatia D -- a metade nova da invariante, na porta 1."""
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).create_member(
                _cmd(raiz, UserTeamRole.SUPERVISOR)
            )


async def test_create_member_aceita_papel_correto_em_cada_nivel(db) -> None:
    """O caminho feliz precisa continuar funcionando nos dois niveis."""
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        svc = MemberService(db)
        na_raiz = await svc.create_member(_cmd(raiz, UserTeamRole.MANAGER))
        no_sub = await svc.create_member(_cmd(sub, UserTeamRole.OPERATOR))
    assert na_raiz.user.id is not None
    assert no_sub.user.id is not None


# ------------------------------------------------------------------
# 3. assign_to_team
# ------------------------------------------------------------------
async def test_assign_to_team_recusa_papel_fora_do_nivel(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    outro = await f.make_user(db, workspace_id=ws)

    with _como_admin(ws, raiz, sub, admin):
        svc = MemberService(db)
        # MANAGER num subtime -> nao
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outro, team_id=sub, role=UserTeamRole.MANAGER
            )
        # ⭐ SUPERVISOR na raiz -> NAO. Ate a Spec 045 fatia D esta linha
        # afirmava o contrario ("SIM -- membro do geral"); quem faz papel de
        # membro do geral agora e o OPERATOR, logo abaixo.
        with pytest.raises(BusinessRuleError):
            await svc.assign_to_team(
                user_id=outro, team_id=raiz, role=UserTeamRole.SUPERVISOR
            )
        # OPERATOR na raiz -> sim (o membro do geral)
        no_geral = await svc.assign_to_team(
            user_id=outro, team_id=raiz, role=UserTeamRole.OPERATOR
        )
        assert no_geral.role == UserTeamRole.OPERATOR
        # OPERATOR no subtime -> sim
        vinculo = await svc.assign_to_team(
            user_id=outro, team_id=sub, role=UserTeamRole.OPERATOR
        )
    assert vinculo.role == UserTeamRole.OPERATOR


# ------------------------------------------------------------------
# 4. change_member_role
# ------------------------------------------------------------------
async def test_change_member_role_recusa_promocao_dentro_do_subtime(db) -> None:
    """Promover a MANAGER quem esta em subtime viola a invariante."""
    ws, raiz, sub, admin = await _mundo(db)
    membro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=membro, team_id=sub, role="OPERATOR"
    )

    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).change_member_role(
                user_id=membro, team_id=sub, new_role=UserTeamRole.MANAGER
            )

    papel = (
        await db.execute(
            text("SELECT role FROM user_team WHERE user_id=:u AND team_id=:t"),
            {"u": membro, "t": sub},
        )
    ).scalar_one()
    assert papel == "OPERATOR"  # inalterado


async def test_change_member_role_permite_troca_dentro_do_mesmo_nivel(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    membro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=membro, team_id=sub, role="OPERATOR"
    )
    with _como_admin(ws, raiz, sub, admin):
        vinculo = await MemberService(db).change_member_role(
            user_id=membro, team_id=sub, new_role=UserTeamRole.SUPERVISOR
        )
    assert vinculo.role == UserTeamRole.SUPERVISOR


# ------------------------------------------------------------------
# 5. move_member_subteam
# ------------------------------------------------------------------
async def test_move_member_recusa_levar_manager_para_subtime(db) -> None:
    """O papel VIAJA junto: mover MANAGER da raiz pro subtime violaria."""
    ws, raiz, sub, admin = await _mundo(db)
    gerente = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=raiz, role="MANAGER"
    )

    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).move_member_subteam(
                user_id=gerente, from_team_id=raiz, to_team_id=sub
            )


async def test_mover_OPERATOR_para_raiz_e_o_fluxo_tirar_do_subtime(db) -> None:
    """"Tirar do subtime" = mover pra raiz preservando o papel.

    ⚠️⚠️ ESTE TESTE ERA COM SUPERVISOR, e a Spec 045 fatia D o inverteu --
    leia o de baixo antes de "consertar" qualquer um dos dois.

    O fluxo da Spec 003 continua vivo, e e por isso que OPERATOR ficou nos
    dois niveis: e ele que carrega o caso normal. O que mudou e que o papel
    de SUPERVISOR nao viaja mais junto para a raiz.
    """
    ws, raiz, sub, admin = await _mundo(db)
    operador = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=operador, team_id=sub, role="OPERATOR"
    )

    with _como_admin(ws, raiz, sub, admin):
        vinculo = await MemberService(db).move_member_subteam(
            user_id=operador, from_team_id=sub, to_team_id=raiz
        )
    assert vinculo.team_id == raiz
    assert vinculo.role == UserTeamRole.OPERATOR  # papel preservado


async def test_mover_SUPERVISOR_para_raiz_passa_a_ser_recusado(db) -> None:
    """⭐⭐ A consequencia de produto da fatia D, e a mais fácil de descobrir
    tarde: ela aparece com CLIENTE REAL, nao em teste sintetico.

    ⚠️ ESTE ARQUIVO JA AVISOU UMA VEZ que a invariante "NAO pode barrar isso
    -- foi exatamente o que a versao simetrica da regra quebrou". A diferenca
    e que aquela versao barrava OPERATOR **tambem**, e ai o fluxo inteiro
    morria; esta barra so o SUPERVISOR, e o caso normal (o teste acima) segue
    de pe.

    ⚠️ E A SAIDA E DE DUAS ETAPAS: rebaixar para OPERATOR e depois mover.
    Isso e deliberado -- mover alguem para a raiz e dizer que ela deixou de
    ser dona de um braco operacional, e essa perda de autoridade nao deve
    acontecer por efeito colateral de uma operacao chamada "mover".
    """
    ws, raiz, sub, admin = await _mundo(db)
    supervisor = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=supervisor, team_id=sub, role="SUPERVISOR"
    )

    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).move_member_subteam(
                user_id=supervisor, from_team_id=sub, to_team_id=raiz
            )


async def test_move_member_entre_subtimes_continua_funcionando(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    outro_sub = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="social"
    )
    membro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=membro, team_id=sub, role="OPERATOR"
    )
    with acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz), node(sub, raiz), node(outro_sub, raiz)),
    ):
        vinculo = await MemberService(db).move_member_subteam(
            user_id=membro, from_team_id=sub, to_team_id=outro_sub
        )
    assert vinculo.team_id == outro_sub


# ------------------------------------------------------------------
# 6-7. TeamService: 409 de dominio, NUNCA IntegrityError
# ------------------------------------------------------------------
async def test_create_segunda_raiz_da_conflict_e_nao_integrity_error(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(ConflictError):
            await TeamService(db).create(name="Outra Raiz", slug="outra-raiz")


async def test_promover_subtime_a_raiz_da_conflict_e_nao_integrity_error(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(ConflictError):
            await TeamService(db).move(team_id=sub, new_parent_id=None)


async def test_criar_subtime_continua_liberado(db) -> None:
    """A trava e so pra raiz -- subtime nao tem limite."""
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        novo = await TeamService(db).create(
            name="Design", slug="design", parent_team_id=raiz
        )
    assert novo.parent_team_id == raiz


async def test_mover_subtime_entre_pais_continua_liberado(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    neto = await f.make_team(
        db, workspace_id=ws, parent_team_id=sub, slug="crm-junior"
    )
    with _como_admin(ws, raiz, sub, admin):
        movido = await TeamService(db).move(team_id=neto, new_parent_id=raiz)
    assert movido.parent_team_id == raiz


# ------------------------------------------------------------------
# 8. o workspace nunca fica sem raiz
# ------------------------------------------------------------------
async def test_mover_a_raiz_para_baixo_de_descendente_continua_barrado(db) -> None:
    """Unica forma de orfanar o workspace seria pendurar a raiz num filho.

    Ja e barrado pela deteccao de CICLO -- mas isso e consequencia
    acidental de outra regra. Este teste trava o comportamento: se alguem
    afrouxar o ciclo um dia, o workspace poderia ficar sem topo.
    """
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await TeamService(db).move(team_id=raiz, new_parent_id=sub)

    raizes = (
        await db.execute(
            text(
                "SELECT count(*) FROM team "
                "WHERE workspace_id=:w AND parent_team_id IS NULL"
            ),
            {"w": ws},
        )
    ).scalar_one()
    assert raizes == 1


# ------------------------------------------------------------------
# 10-11. indice unico e isolamento de tenant
# ------------------------------------------------------------------
async def test_indice_recusa_segunda_raiz_direto_no_banco(db) -> None:
    """Defesa em profundidade: mesmo contornando o service, o banco recusa."""
    ws, _raiz, _sub, _admin = await _mundo(db)
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "INSERT INTO team (id, workspace_id, parent_team_id, name, slug) "
                "VALUES (gen_random_uuid(), :w, NULL, 'Raiz Dois', 'raiz-dois')"
            ),
            {"w": ws},
        )
        await db.flush()


async def test_raiz_de_workspaces_diferentes_nao_conflita(db) -> None:
    """O indice e por workspace: cada tenant tem a SUA raiz."""
    ws_a, raiz_a, _sub_a, _admin_a = await _mundo(db)
    ws_b, raiz_b, _sub_b, _admin_b = await _mundo(db)
    assert raiz_a != raiz_b

    linhas = (
        await db.execute(
            text(
                "SELECT workspace_id, count(*) FROM team "
                "WHERE parent_team_id IS NULL AND workspace_id IN (:a, :b) "
                "GROUP BY workspace_id"
            ),
            {"a": ws_a, "b": ws_b},
        )
    ).all()
    assert sorted(n for _, n in linhas) == [1, 1]
