"""Router de autenticacao: login, refresh, me, troca de senha e logout."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import CurrentUserDep, PendingUserDep
from app.modules.auth.api.schemas import (
    ChangePasswordRequest,
    CurrentUserResponse,
    LoginRequest,
    RefreshRequest,
    RenameSelfRequest,
    RenameSelfResponse,
    TeamMembershipOut,
    TokenPair,
)
from app.modules.auth.application.service import AuthService
from app.modules.auth.domain.permissions import (
    permissions_for_org_role,
    permissions_for_roles,
)
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from app.shared.exceptions.base import AuthenticationError

router = APIRouter(prefix="/auth", tags=["auth"])


# Sem freio por IP: a instituicao inteira sai pelo mesmo IP (NAT). Forca bruta
# fica com o freio por conta, que so conta falha.
@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    """Autentica por e-mail + senha + workspace e devolve o par de tokens."""
    service = AuthService(session)
    return await service.login(
        email=payload.email,
        password=payload.password,
        workspace_slug=payload.workspace_slug,
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    """Renova o access token a partir de um refresh token valido."""
    service = AuthService(session)
    return await service.refresh(refresh_token=payload.refresh_token)


@router.get(
    "/me", response_model=CurrentUserResponse, status_code=status.HTTP_200_OK
)
async def me(user: PendingUserDep, session: SessionDep) -> CurrentUserResponse:
    """Devolve o usuario autenticado, com roles e permissions.

    Leniente: funciona com a troca de senha pendente, para o front ler
    `must_change_password`.
    """
    membership = await MembershipRepository(session).get_membership(
        user_id=user.id, workspace_id=user.workspace_id
    )
    if membership is None:
        raise AuthenticationError("Usuario do token nao encontrado.")
    # Papeis de time + papel de organizacao: o front deriva o alcance daqui.
    permissions = permissions_for_roles(membership.roles) | permissions_for_org_role(
        membership.org_role
    )
    # O papel de organizacao entra em `roles` so na resposta. Quem consome este
    # payload no front: `permissoesMembros.alcanceDe` e `lens.computeLens`.
    roles = membership.roles | (
        frozenset({membership.org_role}) if membership.org_role else frozenset()
    )
    return CurrentUserResponse(
        id=user.id,
        workspace_id=user.workspace_id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        roles=sorted(roles),
        permissions=sorted(permissions),
        org_role=membership.org_role,
        teams=[
            TeamMembershipOut(team_id=team_id, role=role)
            for team_id, role in membership.team_roles
        ],
    )


@router.patch("/me", response_model=RenameSelfResponse)
async def rename_self(
    payload: RenameSelfRequest, user: CurrentUserDep, uow: UoWDep
) -> RenameSelfResponse:
    """Troca o proprio nome. Exige a senha obrigatoria ja trocada."""
    atualizado = await AuthService(uow.session).rename_self(
        user_id=user.id, name=payload.name
    )
    await uow.commit()
    return RenameSelfResponse(name=atualizado.name)


@router.post("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest, user: PendingUserDep, uow: UoWDep
) -> dict[str, bool]:
    """Troca a senha do proprio usuario (1o acesso ou voluntaria).

    Leniente: e a rota pela qual o usuario com troca pendente destrava.
    """
    await AuthService(uow.session).change_password(
        user_id=user.id,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    await uow.commit()
    return {"changed": True}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: PendingUserDep, uow: UoWDep) -> Response:
    """Encerra todas as sessoes do usuario.

    Leniente: quem esta com troca de senha pendente precisa conseguir sair.
    """
    await AuthService(uow.session).logout(user_id=user.id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
