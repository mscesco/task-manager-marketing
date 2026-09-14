"""Dependencies de autenticacao e autorizacao.

Implementa o fluxo pedido na foundation:

    JWT  ->  dependency  ->  current user  ->  workspace
         ->  membership (roles)  ->  TenantContext

Estas dependencies sao o ponto onde:
    1. o JWT do header Authorization e validado;
    2. o usuario e a membership (papeis no workspace) sao
       carregados do banco;
    3. as permissions sao derivadas dos papeis;
    4. o TenantContext (ContextVar) e POPULADO -- a partir
       dai, repositories e services enxergam workspace,
       roles e permissions sem receber parametro.

Uma rota fica protegida ao depender de `CurrentUserDep` ou
`TenantContextDep`. Rotas sem essas dependencies sao
publicas (login, health). Isso torna explicito, rota a
rota, o que exige autenticacao.

`require_permission(...)` e uma fabrica de dependency para
proteger rotas por permissao especifica.
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
    """Resolve o TenantContext completo da requisicao.

    Esta e a dependency central de autenticacao. Apos ela, o
    ContextVar de tenant esta populado com workspace, user,
    roles e permissions.
    """
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Credenciais ausentes.")

    payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)

    try:
        user_id = uuid.UUID(payload["sub"])
        workspace_id = uuid.UUID(payload["ws"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Token malformado.") from exc

    # Carrega a membership (usuario + papeis no workspace).
    membership_repo = MembershipRepository(session)
    membership = await membership_repo.get_membership(
        user_id=user_id, workspace_id=workspace_id
    )
    if membership is None:
        raise AuthenticationError("Usuario do token nao encontrado.")
    if not membership.is_active:
        raise AuthenticationError("Usuario inativo.")

    # Spec 030: revogacao de sessao. O token carrega a versao do momento da
    # emissao; se o contador do usuario avancou (troca de senha, reset pelo
    # gestor, logout), este token morreu. Custo zero -- a linha do usuario ja
    # foi lida acima, junto de is_active.
    if token_version_of(payload) != membership.token_version:
        raise AuthenticationError("Sessao revogada. Faca login novamente.")

    # Entrega 7 (ADR 0020): gate de troca obrigatoria. Aplicado AQUI, no
    # ponto unico por onde passa toda rota de negocio, falha fechado --
    # rota nova futura ja nasce coberta. As rotas que precisam funcionar
    # com a pendencia (auth/change-password, auth/me) usam a dependency
    # leniente get_user_allowing_pending, que NAO passa por aqui.
    if membership.must_change_password:
        raise PasswordChangeRequiredError()

    # Deriva permissoes dos papeis (mapa estatico, sem RBAC em tabela).
    #
    # ⚠️ DUAS PERGUNTAS, E NAO UMA (Spec 045, fatia B): os papeis de TIME
    # respondem uma; o papel de ORGANIZACAO, que nao tem time, responde outra.
    # A uniao e o que a pessoa pode. Sem a segunda parcela, um ADMIN de
    # organizacao sem vinculo de time nenhum entraria no sistema com PERMISSAO
    # VAZIA -- e e exatamente esse o estado que esta fatia torna normal.
    # ⭐ Spec 045, fatia C: a permissao passa a CARREGAR O TIME. O objeto
    # responde `can` ("em algum lugar", para o portao de rota) e `can_in`
    # ("naquele time", para o servico). O `in` continua funcionando com a
    # semantica ampla, entao `has_permission` e `/auth/me` nao mudam.
    #
    # ⚠️ Montado DEPOIS de `memberships` e `team_tree`, porque precisa dos dois:
    # o vinculo diz o time, a arvore diz a subarvore de um papel de comando.

    # Entrega 3: pares (time, papel) + arvore de times, para o escopo
    # por time. roles/permissions seguem como camada de "quais acoes".
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

    # Popula o ContextVar. Escopo da task asyncio da requisicao;
    # nao precisa reset manual.
    set_tenant(context)
    return context


async def get_current_user(
    context: Annotated[TenantContext, Depends(get_tenant_context)],
    session: SessionDep,
) -> User:
    """Carrega a entidade User do usuario autenticado.

    Depende de get_tenant_context (que ja validou o token e
    populou o contexto). Use quando a rota precisa dos dados
    do usuario; para apenas autorizar, TenantContextDep basta.
    """
    user = await session.get(User, context.user_id)
    if user is None:
        # Inconsistente: a membership existia mas o user sumiu.
        raise AuthenticationError("Usuario nao encontrado.")
    return user


def _assert_known_permissions(*permissions: str) -> None:
    """Recusa, NO IMPORT DO ROUTER, permissao que nenhum papel concede.

    ⚠️⚠️ Spec 049, fatia A. Sem isto, uma rota que cobra um nome renomeado (ou
    escrito errado) sobe normalmente e responde 403 para TODO MUNDO, inclusive
    o ADMIN -- e a unica pista e a tela de quem clicou. Com isto, o app nem
    importa: `create_app()` falha no primeiro teste da suite, com o nome na
    mensagem.
    """
    desconhecidas = [p for p in permissions if p not in ALL_PERMISSIONS]
    if desconhecidas:
        raise ValueError(
            f"Permissao desconhecida em rota: {desconhecidas}. Nenhum papel a "
            "concede (ver `ALL_PERMISSIONS` em auth/domain/permissions.py)."
        )


def require_permission(permission: str) -> Callable[..., TenantContext]:
    """Fabrica de dependency: protege uma rota por permissao.

    Uso na rota::

        @router.post(
            "/tasks",
            dependencies=[Depends(require_permission("task.create"))],
        )

    Retorna o TenantContext (a rota pode receber tambem, se
    quiser). Lanca AuthorizationError (-> HTTP 403) se o
    usuario autenticado nao tiver a permissao.
    """
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
    """Fabrica de dependency: passa se o ator tiver QUALQUER uma das permissoes.

    Uso na rota::

        @router.post(
            "/{user_id}/teams",
            dependencies=[Depends(require_any_permission(
                "team.manage", "member.manage.subteam",
            ))],
        )

    Introduzida pela Spec 028, onde a mesma rota atende dois perfis com
    alcances diferentes: ADMIN/MANAGER (amplo) e SUPERVISOR (so OPERATOR do
    proprio subtime).

    IMPORTANTE -- este guard e a porta, nao a regra. Ele so responde "pode
    bater nesta rota?". QUEM pode mexer em QUEM continua sendo decidido no
    service, que e onde existe o team_id do alvo. Nunca afrouxe uma rota
    para `member.manage.subteam` sem o gate correspondente no service.

    Lanca AuthorizationError (-> HTTP 403) se nao tiver nenhuma.
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


# Type aliases para deixar as assinaturas das rotas limpas.
TenantContextDep = Annotated[TenantContext, Depends(get_tenant_context)]
CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def get_user_allowing_pending(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
    session: SessionDep,
) -> User:
    """Valida o token e carrega o User SEM aplicar o gate de troca (ADR 0020).

    Uso EXCLUSIVO das rotas que precisam funcionar com a pendencia ativa:
    auth/change-password (onde a pessoa destrava) e auth/me (para o front
    saber o estado e renderizar a tela de troca). NAO popula
    permissions/lente -- e so "quem e o portador deste token".

    Mantem as checagens que NAO dependem da pendencia: token valido,
    usuario existe, usuario do workspace do token, usuario ativo.
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

    # Spec 030: a checagem de revogacao vale AQUI TAMBEM. Esta dependency e
    # leniente quanto a troca de senha pendente, nao quanto a token morto --
    # sem isto, um token revogado ainda leria /auth/me e chamaria /auth/logout.
    if token_version_of(payload) != user.token_version:
        raise AuthenticationError("Sessao revogada. Faca login novamente.")
    return user


PendingUserDep = Annotated[User, Depends(get_user_allowing_pending)]
