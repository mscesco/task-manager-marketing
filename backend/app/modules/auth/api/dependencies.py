"""Dependencies de autenticacao e autorizacao.

Validam o JWT, carregam usuario e papeis, derivam as permissoes e populam o
TenantContext. Rota sem `CurrentUserDep`/`TenantContextDep` e publica.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.deps import SessionDep
from app.core.tenant import Membership, TeamNode, TenantContext, set_tenant
from app.db.models import User
from app.modules.auth.domain.permissions import (
    ALL_PERMISSIONS,
    permissions_for_actor,
)
from app.modules.auth.infrastructure.security import (
    TokenType,
    decode_token,
    token_version_of,
)
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)
from app.shared.exceptions.base import (
    AuthenticationError,
    AuthorizationError,
    PasswordChangeRequiredError,
)

# auto_error=False: nos mesmos lancamos AuthenticationError,
# para a resposta seguir o formato de erro padrao da app.
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_tenant_context(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
    session: SessionDep,
) -> TenantContext:
    """Resolve o TenantContext da requisicao e popula o ContextVar."""
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Credenciais ausentes.")

    payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)

    try:
        user_id = uuid.UUID(payload["sub"])
        workspace_id = uuid.UUID(payload["ws"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Token malformado.") from exc

    membership_repo = MembershipRepository(session)
    membership = await membership_repo.get_membership(
        user_id=user_id, workspace_id=workspace_id
    )
    if membership is None:
        raise AuthenticationError("Usuario do token nao encontrado.")
    if not membership.is_active:
        raise AuthenticationError("Usuario inativo.")

    # Token emitido antes de troca de senha, reset ou logout morreu.
    if token_version_of(payload) != membership.token_version:
        raise AuthenticationError("Sessao revogada. Faca login novamente.")

    # Gate de troca obrigatoria: toda rota de negocio passa aqui. As rotas que
    # precisam funcionar com a pendencia usam get_user_allowing_pending.
    if membership.must_change_password:
        raise PasswordChangeRequiredError()

    # Permissao = papeis de time (com o time) + papel de organizacao (sem time).
    memberships = tuple(
        Membership(team_id=team_id, role=role)
        for team_id, role in membership.team_roles
    )
    tree_rows = await membership_repo.load_team_tree(workspace_id=workspace_id)
    team_tree = tuple(
        TeamNode(team_id=tid, parent_team_id=pid) for tid, pid in tree_rows
    )
    permissions = permissions_for_actor(
        memberships=memberships, tree=team_tree, org_role=membership.org_role
    )

    context = TenantContext(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=membership.roles,
        permissions=permissions,
        memberships=memberships,
        team_tree=team_tree,
        org_role=membership.org_role,
    )

    # Escopo da task asyncio da requisicao; nao precisa reset.
    set_tenant(context)
    return context


async def get_current_user(
    context: Annotated[TenantContext, Depends(get_tenant_context)],
    session: SessionDep,
) -> User:
    """Carrega o User autenticado; para so autorizar, TenantContextDep basta."""
    user = await session.get(User, context.user_id)
    if user is None:
        raise AuthenticationError("Usuario nao encontrado.")
    return user


def _assert_known_permissions(*permissions: str) -> None:
    """Recusa, no import do router, permissao que nenhum papel concede.

    Sem isto, um nome errado sobe e responde 403 para todo mundo.
    """
    desconhecidas = [p for p in permissions if p not in ALL_PERMISSIONS]
    if desconhecidas:
        raise ValueError(
            f"Permissao desconhecida em rota: {desconhecidas}. Nenhum papel a "
            "concede (ver `ALL_PERMISSIONS` em auth/domain/permissions.py)."
        )


def require_permission(permission: str) -> Callable[..., TenantContext]:
    """Fabrica de dependency: protege uma rota por permissao (403 se faltar)."""
    _assert_known_permissions(permission)

    def _guard(
        context: Annotated[TenantContext, Depends(get_tenant_context)],
    ) -> TenantContext:
        if not context.has_permission(permission):
            raise AuthorizationError(
                f"Permissao necessaria: {permission}.",
                details={"required_permission": permission},
            )
        return context

    return _guard


def require_any_permission(*permissions: str) -> Callable[..., TenantContext]:
    """Fabrica de dependency: passa se o ator tiver qualquer uma das permissoes.

    E so a porta da rota; quem pode mexer em quem e decidido no service,
    onde existe o time do alvo.
    """
    _assert_known_permissions(*permissions)

    def _guard(
        context: Annotated[TenantContext, Depends(get_tenant_context)],
    ) -> TenantContext:
        if not any(context.has_permission(p) for p in permissions):
            raise AuthorizationError(
                "Permissao necessaria: "
                + " ou ".join(permissions)
                + ".",
                details={"required_any_of": list(permissions)},
            )
        return context

    return _guard


TenantContextDep = Annotated[TenantContext, Depends(get_tenant_context)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def get_user_allowing_pending(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
    session: SessionDep,
) -> User:
    """Valida o token e carrega o User sem o gate de troca de senha.

    So para as rotas que funcionam com a pendencia (change-password, me,
    logout). Nao popula permissoes.
    """
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Credenciais ausentes.")

    payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    try:
        user_id = uuid.UUID(payload["sub"])
        workspace_id = uuid.UUID(payload["ws"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Token malformado.") from exc

    user = await session.get(User, user_id)
    if user is None or user.workspace_id != workspace_id:
        raise AuthenticationError("Usuario do token nao encontrado.")
    if not user.is_active:
        raise AuthenticationError("Usuario inativo.")

    # Leniente com a troca pendente, nao com token revogado.
    if token_version_of(payload) != user.token_version:
        raise AuthenticationError("Sessao revogada. Faca login novamente.")
    return user


PendingUserDep = Annotated[User, Depends(get_user_allowing_pending)]
