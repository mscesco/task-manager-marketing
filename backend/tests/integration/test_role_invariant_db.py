"""Papel por nivel de time, no banco: MANAGER so na raiz, SUPERVISOR so em subtime.

Os erros de dominio tem de sair como 409, nunca como IntegrityError (500).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db.models.enums import UserTeamRole
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)
from app.modules.workspaces.application.workspace_service import TeamService
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Workspace com raiz + um subtime + um ADMIN de organizacao."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    return ws, raiz, sub, admin


def _como_admin(ws, raiz, sub, admin):
    return acting_as(
        workspace_id=ws,
        user_id=admin,
        memberships=(),
        team_tree=(node(raiz), node(sub, raiz)),
        org_role="ADMIN",
    )


def _cmd(team_id: uuid.UUID, role: UserTeamRole) -> CreateMemberCommand:
    return CreateMemberCommand(
        name="Fulano de Teste",
        email=f"fulano-{uuid.uuid4().hex[:8]}@teste.dev",
        team_id=team_id,
        role=role,
    )


# ------------------------------------------------------------------
# create_member
# ------------------------------------------------------------------
async def test_create_member_recusa_manager_em_subtime(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).create_member(_cmd(sub, UserTeamRole.MANAGER))

    # nada gravado
    total = (
        await db.execute(
            text("SELECT count(*) FROM user_team WHERE team_id=:t"), {"t": sub}
        )
    ).scalar_one()
    assert total == 0


async def test_create_member_recusa_supervisor_na_raiz(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await MemberService(db).create_member(
                _cmd(raiz, UserTeamRole.SUPERVISOR)
            )


async def test_create_member_aceita_papel_correto_em_cada_nivel(db) -> None:
    """MANAGER e OPERATOR na raiz, OPERATOR no subtime: os tres valem."""
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        svc = MemberService(db)
        na_raiz = await svc.create_member(_cmd(raiz, UserTeamRole.MANAGER))
        operador_na_raiz = await svc.create_member(_cmd(raiz, UserTeamRole.OPERATOR))
        no_sub = await svc.create_member(_cmd(sub, UserTeamRole.OPERATOR))
    assert na_raiz.user.id is not None
    assert operador_na_raiz.user.id is not None
    assert no_sub.user.id is not None


# ------------------------------------------------------------------
# assign_to_team
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
        # SUPERVISOR na raiz -> nao
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
# change_member_role
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
# TeamService: erro de dominio, nunca IntegrityError
# ------------------------------------------------------------------
async def test_criar_SEGUNDO_time_raiz_funciona(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        nova = await TeamService(db).create(name="TI", slug="ti")

    assert nova.parent_team_id is None
    assert nova.id != raiz


async def test_criar_time_raiz_exige_papel_de_ORGANIZACAO(db) -> None:
    """MANAGER nao cria time raiz, so subtime.

    A trava mora no servico: `POST /teams` cria os dois, e so o `parent_team_id`
    do corpo os separa.
    """
    ws, raiz, sub, admin = await _mundo(db)
    gerente = await f.make_user(db, workspace_id=ws, email="mgr@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gerente, team_id=raiz, role="MANAGER"
    )

    with acting_as(
        workspace_id=ws,
        user_id=gerente,
        memberships=(mship(raiz, "MANAGER"),),
        team_tree=(node(raiz), node(sub, raiz)),
    ):
        svc = TeamService(db)
        with pytest.raises(AuthorizationError):
            await svc.create(name="TI", slug="ti")
        # Subtime continua liberado: a trava e so para time raiz.
        dele = await svc.create(name="Design", slug="design", parent_team_id=raiz)
    assert dele.parent_team_id == raiz


async def test_promover_subtime_a_time_raiz_continua_recusado(db) -> None:
    """O banco aceitaria; a operacao e que nao esta desenhada."""
    ws, raiz, sub, admin = await _mundo(db)
    with _como_admin(ws, raiz, sub, admin):
        with pytest.raises(BusinessRuleError):
            await TeamService(db).move(team_id=sub, new_parent_id=None)


async def test_mover_subtime_entre_pais_continua_liberado(db) -> None:
    ws, raiz, sub, admin = await _mundo(db)
    neto = await f.make_team(
        db, workspace_id=ws, parent_team_id=sub, slug="crm-junior"
    )
    with _como_admin(ws, raiz, sub, admin):
        movido = await TeamService(db).move(team_id=neto, new_parent_id=raiz)
    assert movido.parent_team_id == raiz


# ------------------------------------------------------------------
# o workspace nunca fica sem raiz
# ------------------------------------------------------------------
async def test_mover_a_raiz_para_baixo_de_descendente_continua_barrado(db) -> None:
    """Pendurar a raiz num filho deixaria o workspace sem topo; o ciclo barra."""
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
# schema
# ------------------------------------------------------------------
async def test_o_slug_continua_unico_por_workspace(db) -> None:
    """`uq_team_workspace_slug` impede dois times com o mesmo slug, em qualquer nivel."""
    ws, raiz, _sub, _admin = await _mundo(db)
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "INSERT INTO team (id, workspace_id, parent_team_id, name, slug) "
                "SELECT gen_random_uuid(), :w, NULL, 'Clone', slug "
                "FROM team WHERE id = :r"
            ),
            {"w": ws, "r": raiz},
        )
        await db.flush()


async def test_o_banco_recusa_vinculo_ADMIN(db) -> None:
    """ADMIN nao existe em `user_team_role`: nem SQL a mao traz o vinculo de volta."""
    ws, raiz, _sub, _admin = await _mundo(db)
    pessoa = await f.make_user(db, workspace_id=ws)
    with pytest.raises(DBAPIError, match="user_team_role"):
        await db.execute(
            text(
                "INSERT INTO user_team (id, workspace_id, user_id, team_id, role) "
                "VALUES (gen_random_uuid(), :w, :u, :t, 'ADMIN')"
            ),
            {"w": ws, "u": pessoa, "t": raiz},
        )
