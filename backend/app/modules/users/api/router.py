"""Rotas de membros do workspace (`/members`). Sem signup publico: membros
entram cadastrados por quem administra.

Cada rota cobra o verbo da acao (`person.*`, `membership.*`, `org_role.*`); o
"onde" (alcance no time) e decidido no servico.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import SessionDep, UoWDep
from app.db.models import User
from app.modules.auth.api.dependencies import (
    TenantContextDep,
    require_any_permission,
    require_permission,
)
from app.modules.users.api.schemas import (
    ChangeMemberRoleRequest,
    ChangeOrganizationRoleRequest,
    MemberAccountActionsResponse,
    MemberCreatedResponse,
    MemberCreateRequest,
    MemberListResponse,
    MemberResponse,
    MemberTeamListItemResponse,
    MemberTeamResponse,
    ResetPasswordResponse,
    TeamAssignmentRequest,
    TeamMemberListItemResponse,
    TeamMembershipResponse,
)
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=MemberListResponse)
async def list_members(
    _: TenantContextDep,
    session: SessionDep,
    reaches_task: uuid.UUID | None = Query(
        None,
        description=(
            "Filtra a lista para quem ALCANCA esta task. "
            "Ausente = lista completa, comportamento historico."
        ),
    ),
    reaches_team: uuid.UUID | None = Query(
        None,
        description=(
            "Filtra para quem enxerga as tasks deste TIME. "
            "Para o modal de criar, onde a task ainda nao existe. "
            "Mutuamente exclusivo com reaches_task (422)."
        ),
    ),
) -> MemberListResponse:
    """Lista os membros do workspace. Varias telas usam o caminho sem filtro."""
    members = await MemberService(session).list_members(
        reaches_task_id=reaches_task, reaches_team_id=reaches_team
    )
    return MemberListResponse(
        items=[
            MemberResponse(
                id=m.user.id,
                workspace_id=m.user.workspace_id,
                name=m.user.name,
                email=m.user.email,
                is_active=m.user.is_active,
                created_at=m.user.created_at,
                must_change_password=m.user.must_change_password,
                org_role=m.user.org_role,
                # `team_ids` sao so subtimes; `root_team_ids` sao as raizes.
                root_team_ids=m.root_team_ids,
                memberships=[
                    MemberTeamResponse(team_id=tid, role=papel)
                    for tid, papel in m.vinculos
                ],
                team_ids=m.subteam_ids,
            )
            for m in members
        ],
        total=len(members),
    )


# Rota literal antes de `/{user_id}/...`: um `/{user_id}` futuro engoliria `by-team`.
@router.get(
    "/by-team/{team_id}",
    response_model=list[TeamMemberListItemResponse],
)
async def list_team_members(
    team_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[TeamMemberListItemResponse]:
    """Os vinculos de um time, com o cadeado de troca de papel de cada um."""
    svc = MemberService(session)
    linhas = await svc.list_team_members(team_id=team_id)
    return [
        TeamMemberListItemResponse(
            user_id=m.user_id,
            role=m.role,
            is_active=ativo,
            can_edit_role=svc.pode_trocar_papel_do_vinculo(
                user_id=m.user_id,
                team_id=m.team_id,
                papel_atual=m.role,
                alvo_ativo=ativo,
            ),
        )
        for m, ativo in linhas
    ]


@router.get(
    "/{user_id}/account-actions",
    response_model=MemberAccountActionsResponse,
)
async def member_account_actions(
    user_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> MemberAccountActionsResponse:
    """O ator conseguiria resetar a senha, desativar ou reativar esta conta?"""
    (
        pode_resetar,
        pode_desativar,
        pode_reativar,
    ) = await MemberService(session).acoes_da_conta(user_id=user_id)
    return MemberAccountActionsResponse(
        can_reset_password=pode_resetar,
        can_deactivate=pode_desativar,
        can_reactivate=pode_reativar,
    )


@router.get(
    "/{user_id}/teams",
    response_model=list[MemberTeamListItemResponse],
)
async def list_member_teams(
    user_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[MemberTeamListItemResponse]:
    """Todos os vinculos (time, papel, cadeado) de um membro.

    Leitura aberta a qualquer autenticado; o cadeado so diz o que o PATCH
    recusaria.
    """
    svc = MemberService(session)
    memberships = await svc.list_member_teams(user_id=user_id)
    # Conta desativada: cadeado sempre fechado (o PATCH devolveria 409).
    alvo = await session.get(User, user_id)
    ativo = alvo is not None and alvo.is_active
    return [
        MemberTeamListItemResponse(
            team_id=m.team_id,
            role=m.role,
            # A mesma funcao que o PATCH usa, para as duas nao divergirem.
            can_edit_role=svc.pode_trocar_papel_do_vinculo(
                user_id=user_id,
                team_id=m.team_id,
                papel_atual=m.role,
                alvo_ativo=ativo,
            ),
        )
        for m in memberships
    ]


@router.post(
    "",
    response_model=MemberCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("person.create"))],
)
async def create_member(
    payload: MemberCreateRequest, uow: UoWDep
) -> MemberCreatedResponse:
    """Cadastra um membro ja vinculado a um time.

    A senha provisoria volta uma unica vez na resposta e deve ser trocada no
    primeiro acesso.
    """
    command = CreateMemberCommand(
        name=payload.name,
        email=payload.email,
        team_id=payload.team_id,
        role=payload.role,
    )
    provisioned = await MemberService(uow.session).create_member(command)
    await uow.commit()
    user = provisioned.user
    return MemberCreatedResponse(
        id=user.id,
        workspace_id=user.workspace_id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at,
        must_change_password=user.must_change_password,
        password_expires_at=user.password_expires_at,
        temporary_password=provisioned.temporary_password,
    )


@router.post(
    "/{user_id}/reset-password",
    response_model=ResetPasswordResponse,
    dependencies=[Depends(require_permission("person.update"))],
)
async def reset_member_password(
    user_id: uuid.UUID, uow: UoWDep
) -> ResetPasswordResponse:
    """Gera nova senha provisoria (volta uma vez) e exige a troca no acesso."""
    provisioned = await MemberService(uow.session).reset_password(
        user_id=user_id
    )
    await uow.commit()
    user = provisioned.user
    return ResetPasswordResponse(
        user_id=user.id,
        must_change_password=user.must_change_password,
        password_expires_at=user.password_expires_at,
        temporary_password=provisioned.temporary_password,
    )


@router.post(
    "/{user_id}/team",
    response_model=TeamMembershipResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("membership.create"))],
)
async def assign_member_to_team(
    user_id: uuid.UUID, payload: TeamAssignmentRequest, uow: UoWDep
) -> TeamMembershipResponse:
    """Vincula um membro existente a um time, com um papel.

    O alcance (ex.: supervisor so poe OPERATOR no proprio subtime) e decidido
    no servico.
    """
    membership = await MemberService(uow.session).assign_to_team(
        user_id=user_id, team_id=payload.team_id, role=payload.role
    )
    await uow.commit()
    return TeamMembershipResponse.model_validate(membership)


@router.patch(
    "/{user_id}/teams/{team_id}",
    response_model=MemberTeamResponse,
    dependencies=[Depends(require_permission("membership.update"))],
)
async def change_member_role(
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    payload: ChangeMemberRoleRequest,
    uow: UoWDep,
) -> MemberTeamResponse:
    """Troca o papel de um membro num time. Ninguem altera o proprio papel.

    403 se o ator nao pode dar/tirar esse papel; 404 se o vinculo nao existe.
    """
    membership = await MemberService(uow.session).change_member_role(
        user_id=user_id, team_id=team_id, new_role=payload.role
    )
    await uow.commit()
    return MemberTeamResponse(team_id=membership.team_id, role=membership.role)


@router.delete(
    "/{user_id}/teams/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_permission("membership.delete"))],
)
async def remove_member_from_team(
    user_id: uuid.UUID, team_id: uuid.UUID, uow: UoWDep
) -> Response:
    """Remove um membro de um time; as tarefas dele ficam.

    403 se o ator nao pode; 404 se o vinculo nao existe.
    """
    await MemberService(uow.session).remove_member_from_team(
        user_id=user_id, team_id=team_id
    )
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{user_id}/organization-role",
    response_model=MemberResponse,
    # "So admin mexe em admin" depende do corpo e do alvo: fica no servico.
    dependencies=[
        Depends(require_any_permission("org_role.grant", "org_role.revoke"))
    ],
)
async def change_organization_role(
    user_id: uuid.UUID,
    payload: ChangeOrganizationRoleRequest,
    uow: UoWDep,
) -> MemberResponse:
    """Troca o papel de organizacao de uma pessoa; `role: null` remove.

    409 se deixaria a organizacao sem nenhum ADMIN ativo.
    """
    user = await MemberService(uow.session).change_organization_role(
        user_id=user_id, new_role=payload.role
    )
    await uow.commit()
    return MemberResponse.model_validate(user)


@router.post(
    "/{user_id}/deactivate",
    response_model=MemberResponse,
    dependencies=[Depends(require_permission("person.deactivate"))],
)
async def deactivate_member(
    user_id: uuid.UUID, uow: UoWDep
) -> MemberResponse:
    """Desativa um membro (nao apaga). Ninguem desativa a propria conta."""
    user = await MemberService(uow.session).deactivate_member(user_id=user_id)
    await uow.commit()
    return MemberResponse.model_validate(user)


@router.post(
    "/{user_id}/reactivate",
    response_model=MemberResponse,
    dependencies=[Depends(require_permission("person.reactivate"))],
)
async def reactivate_member(
    user_id: uuid.UUID, uow: UoWDep
) -> MemberResponse:
    """Reativa uma conta desativada. A senha nao muda; sessoes antigas nao voltam."""
    user = await MemberService(uow.session).reactivate_member(user_id=user_id)
    await uow.commit()
    return MemberResponse.model_validate(user)
