"""Contexto de tenant da requisicao corrente.

ESTRATEGIA (decidida na foundation):
    ContextVar implicito + assercao explicita.

O `ContextVar` carrega o TenantContext da requisicao. Ele e
populado de duas formas:
    1. Em requisicoes HTTP: pela dependency get_tenant_context,
       a partir do JWT + dados do banco.
    2. Em jobs/workers/N8N (futuro): explicitamente, via
       `tenant_scope(...)`, no inicio do job.

Nenhum router, service ou repository precisa receber
workspace_id como parametro -- ele e lido daqui. O
BaseRepository SEMPRE chama `require_tenant()` antes de
qualquer query: se o contexto nao foi setado, a aplicacao
FALHA ALTO (MissingTenantContextError) em vez de vazar
dados entre tenants.

ContextVar e seguro com async: cada task asyncio enxerga
seu proprio valor, sem vazamento entre requisicoes
concorrentes.

SOBRE roles/permissions:
    `roles` sao os papeis do usuario nas equipes do
    workspace (enum user_team_role do schema v5).
    `permissions` sao derivadas dos roles por um mapa
    estatico simples (app.modules.auth.domain.permissions)
    -- NAO ha tabela de RBAC. E um ponto de partida
    pragmatico, evoluivel sem quebrar este contrato.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Iterator

from app.shared.exceptions.base import MissingTenantContextError


@dataclass(frozen=True, slots=True)
class Membership:
    """Vinculo (time, papel) do usuario. Entrega 3.

    `role` e o valor do enum user_team_role (ex. "MANAGER").
    """

    team_id: uuid.UUID
    role: str


@dataclass(frozen=True, slots=True)
class TeamNode:
    """No da arvore de times do workspace (id + pai). Entrega 3.

    Carregado uma vez por requisicao; consumido pelo team_scope (puro)
    para resolver visibilidade/edicao por hierarquia.
    """

    team_id: uuid.UUID
    parent_team_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Identidade e autorizacao resolvidas da requisicao corrente.

    Imutavel: uma vez setado para a requisicao, nao muda.

    Campos:
        workspace_id : o tenant ativo.
        user_id      : o usuario autenticado.
        roles        : papeis do usuario no workspace (strings
                       do enum user_team_role). Pode ser vazio.
        permissions  : permissoes derivadas dos roles.
        memberships  : pares (time, papel) do usuario (Entrega 3).
        team_tree    : arvore de times do workspace (Entrega 3).
    """

    workspace_id: uuid.UUID
    user_id: uuid.UUID
    roles: frozenset[str] = field(default_factory=frozenset)
    permissions: frozenset[str] = field(default_factory=frozenset)
    memberships: tuple[Membership, ...] = ()
    team_tree: tuple[TeamNode, ...] = ()
    #: Papel na ORGANIZACAO -- sem time (Spec 045, fatia B). `None` = nenhum.
    #: Quem tem papel aqui NAO precisa de vinculo de time nenhum.
    org_role: str | None = None

    def has_role(self, role: str) -> bool:
        """True se o usuario tem o papel informado no workspace.

        ⚠️ RESPONDE PELOS DOIS NIVEIS (Spec 045, fatia B). `has_role("ADMIN")`
        e usado pela matriz C2 do `MemberService` para decidir quem administra
        quem; se ele olhasse so os papeis de TIME, o ADMIN de organizacao --
        que por desenho nao tem time nenhum -- deixaria de administrar qualquer
        pessoa no instante em que o vinculo dele saisse de `user_team`.
        """
        return role in self.roles or role == self.org_role

    def has_permission(self, permission: str) -> bool:
        """True se o usuario tem a permissao informada.

        Usado por dependencies/guards de autorizacao. NAO lanca
        -- quem chama decide o que fazer com o False.
        """
        return permission in self.permissions


# O ContextVar em si. `default=None` => "nao setado".
_tenant_ctx: ContextVar[TenantContext | None] = ContextVar(
    "tenant_context", default=None
)


def set_tenant(context: TenantContext) -> Token[TenantContext | None]:
    """Seta o contexto de tenant. Retorna um Token para reset posterior.

    Usado pela dependency de auth. Para jobs, prefira o
    context manager `tenant_scope()`, que cuida do reset.
    """
    return _tenant_ctx.set(context)


def reset_tenant(token: Token[TenantContext | None]) -> None:
    """Restaura o contexto ao estado anterior ao `set_tenant`."""
    _tenant_ctx.reset(token)


def current_tenant() -> TenantContext | None:
    """Retorna o contexto corrente, ou None se nao houver."""
    return _tenant_ctx.get()


def require_tenant() -> TenantContext:
    """Retorna o contexto corrente ou falha alto.

    Esta e a funcao que o BaseRepository chama. Se ela lanca
    MissingTenantContextError, e um BUG: alguem tentou acessar
    dados operacionais fora de um contexto de tenant valido.
    """
    context = _tenant_ctx.get()
    if context is None:
        raise MissingTenantContextError(
            "Operacao requer contexto de tenant. Nenhum workspace "
            "ativo na requisicao/job corrente."
        )
    return context


def current_workspace_id() -> uuid.UUID:
    """Atalho: workspace_id do tenant corrente (falha alto se ausente)."""
    return require_tenant().workspace_id


@contextmanager
def tenant_scope(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    roles: frozenset[str] | None = None,
    permissions: frozenset[str] | None = None,
    memberships: tuple[Membership, ...] = (),
    team_tree: tuple[TeamNode, ...] = (),
) -> Iterator[TenantContext]:
    """Context manager para setar tenant em jobs/workers/scripts.

    Exemplo (job futuro do N8N ou worker de fila)::

        with tenant_scope(ws_id, system_user_id):
            await task_service.do_something()

    Garante o reset do contexto ao sair do bloco, mesmo em erro.
    """
    context = TenantContext(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=roles or frozenset(),
        permissions=permissions or frozenset(),
        memberships=memberships,
        team_tree=team_tree,
    )
    token = _tenant_ctx.set(context)
    try:
        yield context
    finally:
        _tenant_ctx.reset(token)
