"""Router do modulo users -- gestao de membros do workspace.

Como nao ha signup publico, e por estas rotas que usuarios
entram no sistema: um admin/manager cadastra os membros.

Autorizacao: cadastrar, vincular e desativar membros exige
a permissao "team.manage" (ADMIN e MANAGER a possuem).
Listar membros exige apenas estar autenticado.

Rotas:
    GET    /members                       -- listar membros
    POST   /members                       -- cadastrar membro (team.manage)
    POST   /members/{user_id}/reset-password -- resetar senha (team.manage)
    POST   /members/{user_id}/team         -- vincular a equipe (team.manage)
    POST   /members/{user_id}/deactivate   -- desativar membro (team.manage)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.users.api.schemas import (
    MemberCreatedResponse,
    MemberCreateRequest,
    MemberListResponse,
    MemberResponse,
    ResetPasswordResponse,
    TeamAssignmentRequest,
    TeamMembershipResponse,
)
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=MemberListResponse)
async def list_members(
    _: TenantContextDep, session: SessionDep
) -> MemberListResponse:
    """Lista todos os membros ativos do workspace corrente."""
    members = await MemberService(session).list_members()
    return MemberListResponse(
        items=[
            MemberResponse(
                id=m.user.id,
                workspace_id=m.user.workspace_id,
                name=m.user.name,
                email=m.user.email,
                is_active=m.user.is_active,
                created_at=m.user.created_at,
                team_id=m.subteam_id,
            )
            for m in members
        ],
        total=len(members),
    )


@router.post(
    "",
    response_model=MemberCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("team.manage"))],
)
async def create_member(
    payload: MemberCreateRequest, uow: UoWDep
) -> MemberCreatedResponse:
    """Cadastra um novo membro no workspace. Exige team.manage.

    Entrega 7: o backend gera uma senha provisoria; o membro a troca no
    1o acesso (gate, ADR 0020). O `temporary_password` vem na resposta
    UMA vez (ADR 0021) -- repasse-o ao membro pelo canal que tiver.

    Opcionalmente ja vincula o membro a uma equipe (informe team_id e
    role juntos).
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
    dependencies=[Depends(require_permission("team.manage"))],
)
async def reset_member_password(
    user_id: uuid.UUID, uow: UoWDep
) -> ResetPasswordResponse:
    """Reset administrativo de senha. Exige team.manage.

    Gera nova senha provisoria e re-arma a troca obrigatoria. A senha
    anterior deixa de valer. O segredo novo volta UMA vez (ADR 0021).
    """
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
    dependencies=[Depends(require_permission("team.manage"))],
)
async def assign_member_to_team(
    user_id: uuid.UUID, payload: TeamAssignmentRequest, uow: UoWDep
) -> TeamMembershipResponse:
    """Vincula um membro existente a uma equipe, com um papel."""
    membership = await MemberService(uow.session).assign_to_team(
        user_id=user_id, team_id=payload.team_id, role=payload.role
    )
    await uow.commit()
    return TeamMembershipResponse.model_validate(membership)


@router.post(
    "/{user_id}/deactivate",
    response_model=MemberResponse,
    dependencies=[Depends(require_permission("team.manage"))],
)
async def deactivate_member(
    user_id: uuid.UUID, uow: UoWDep
) -> MemberResponse:
    """Desativa um membro (nao deleta). Exige team.manage.

    Um membro nao pode desativar a propria conta.
    """
    user = await MemberService(uow.session).deactivate_member(user_id=user_id)
    await uow.commit()
    return MemberResponse.model_validate(user)
