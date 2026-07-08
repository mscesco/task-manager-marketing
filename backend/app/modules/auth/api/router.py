"""Router de autenticacao.

Demonstra a regra de ouro da foundation: o router so cuida
de request/response, validacao, DI e status code. Nenhuma
regra de negocio aqui -- tudo delegado ao AuthService.

Rotas:
    POST /auth/login    -- publica
    POST /auth/refresh  -- publica
    GET  /auth/me       -- protegida (exige access token)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.core.deps import SessionDep, UoWDep
from app.core.rate_limit import login_limiter, rate_limit, refresh_limiter
from app.modules.auth.api.dependencies import PendingUserDep
from app.modules.auth.api.schemas import (
    ChangePasswordRequest,
    CurrentUserResponse,
    TeamMembershipOut,
    LoginRequest,
    RefreshRequest,
    TokenPair,
)
from app.modules.auth.application.service import AuthService
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from app.shared.exceptions.base import AuthenticationError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=TokenPair,
    dependencies=[Depends(rate_limit(login_limiter))],
)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    """Autentica por e-mail + senha + workspace e devolve o par de tokens."""
    service = AuthService(session)
    return await service.login(
        email=payload.email,
        password=payload.password,
        workspace_slug=payload.workspace_slug,
    )


@router.post(
    "/refresh",
    response_model=TokenPair,
    dependencies=[Depends(rate_limit(refresh_limiter))],
)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    """Renova o access token a partir de um refresh token valido."""
    service = AuthService(session)
    return await service.refresh(refresh_token=payload.refresh_token)


@router.get(
    "/me", response_model=CurrentUserResponse, status_code=status.HTTP_200_OK
)
async def me(user: PendingUserDep, session: SessionDep) -> CurrentUserResponse:
    """Devolve o usuario autenticado, com roles e permissions.

    Usa a dependency leniente (PendingUserDep): funciona mesmo com a troca
    de senha pendente, para o front ler `must_change_password` e
    redirecionar a tela de troca (ADR 0020). Roles/permissions sao
    resolvidos aqui, sem passar pelo gate.
    """
    membership = await MembershipRepository(session).get_membership(
        user_id=user.id, workspace_id=user.workspace_id
    )
    if membership is None:
        raise AuthenticationError("Usuario do token nao encontrado.")
    permissions = permissions_for_roles(membership.roles)
    return CurrentUserResponse(
        id=user.id,
        workspace_id=user.workspace_id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        roles=sorted(membership.roles),
        permissions=sorted(permissions),
        teams=[
            TeamMembershipOut(team_id=team_id, role=role)
            for team_id, role in membership.team_roles
        ],
    )


@router.post("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest, user: PendingUserDep, uow: UoWDep
) -> dict[str, bool]:
    """Troca a senha do proprio usuario (1o acesso ou voluntaria).

    Usa a dependency leniente (permite a pendencia, ADR 0020) -- e a unica
    rota de "acao" que um usuario travado consegue executar. Ao concluir,
    a pendencia e a expiracao sao zeradas e o usuario destrava.
    """
    await AuthService(uow.session).change_password(
        user_id=user.id,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    await uow.commit()
    return {"changed": True}
