"""Router de autenticacao.

Demonstra a regra de ouro da foundation: o router so cuida
de request/response, validacao, DI e status code. Nenhuma
regra de negocio aqui -- tudo delegado ao AuthService.

Rotas:
    POST /auth/login    -- publica
    POST /auth/refresh  -- publica
    POST /auth/logout   -- protegida (leniente: funciona com troca pendente)
    GET  /auth/me       -- protegida (exige access token)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

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
from app.modules.auth.domain.permissions import (
    permissions_for_org_role,
    permissions_for_roles,
)
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
    # ⚠️ AS DUAS PARCELAS (Spec 045, fatia B) -- e aqui e ainda mais critico que
    # no `get_tenant_context`: esta rota alimenta o `currentUser` do front, e o
    # front deriva o ALCANCE inteiro dela (`lib/permissoesMembros.alcanceDe`).
    # Sem a segunda parcela, um ADMIN de organizacao sem vinculo de time
    # nenhum abriria a tela sem papel e sem permissao -- e a tela nao mostraria
    # botao algum, o que parece "perdi o acesso" e nao "faltou uma linha".
    permissions = permissions_for_roles(membership.roles) | permissions_for_org_role(
        membership.org_role
    )
    # ⚠️ O PAPEL DE ORGANIZACAO ENTRA EM `roles` NA RESPOSTA, e so aqui -- no
    # dominio ele fica separado de proposito (ver `WorkspaceMembership`). Este
    # campo e o contrato com o front, que pergunta "quais papeis esta pessoa
    # tem", sem distinguir nivel. A Spec 047 e que vai separar os dois na tela.
    #
    # ⚠️⚠️ ESTE COMENTARIO DIZIA "Assim a fatia B nao exige mudanca nenhuma no
    # front", E ERA FALSO -- descoberto em PRODUCAO, em 09/09/2026.
    #
    # Era verdade para `permissoesMembros.alcanceDe`, que le `permissions`. E
    # falso para `lib/lens.computeLens`, que montava o MENU a partir de
    # `me.teams` e ignorava `roles`. Com a conta de administracao sem vinculo
    # de time nenhum (passo 2 da fatia B), a lente saiu vazia e os quadros dos
    # subtimes sumiram do menu.
    #
    # ⚠️ O dado sempre esteve aqui -- `roles` ja trazia o papel de organizacao
    # desde a fatia B. O que faltou foi conferir os DOIS consumidores do
    # `/auth/me` no front, e nao um. Se voce mexer neste payload, a lista e:
    # `permissoesMembros.alcanceDe` e `lens.computeLens`.
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
        # ⚠️ SEPARADO de `roles` de proposito -- ver o comentario no schema.
        org_role=membership.org_role,
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


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: PendingUserDep, uow: UoWDep) -> Response:
    """Encerra TODAS as sessoes do usuario (Spec 030, D4).

    Usa a dependency leniente (PendingUserDep) de proposito: quem esta preso
    no gate de troca de senha precisa conseguir sair. Ela ja confere a
    revogacao, entao um token morto nao chega aqui.
    """
    await AuthService(uow.session).logout(user_id=user.id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
