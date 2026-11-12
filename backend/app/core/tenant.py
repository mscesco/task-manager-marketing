"""Contexto de tenant da requisicao corrente, num ContextVar.

Populado pela dependency de auth (HTTP) ou por `tenant_scope` (jobs). O
BaseRepository chama `require_tenant()` antes de toda query: sem contexto,
falha em vez de vazar dados entre tenants.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any

from app.shared.exceptions.base import MissingTenantContextError


@dataclass(frozen=True, slots=True)
class Membership:
    """Vinculo (time, papel do enum user_team_role) do usuario."""

    team_id: uuid.UUID
    role: str


@dataclass(frozen=True, slots=True)
class TeamNode:
    """No da arvore de times do workspace, carregada uma vez por requisicao."""

    team_id: uuid.UUID
    parent_team_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Identidade e autorizacao da requisicao corrente (imutavel)."""

    workspace_id: uuid.UUID
    user_id: uuid.UUID
    roles: frozenset[str] = field(default_factory=frozenset)
    #: `ActorPermissions` (com o time de cada permissao) nas requisicoes; um
    #: `frozenset` plano em jobs e testes. Os dois respondem `in` ("em algum lugar").
    permissions: frozenset[str] | Any = field(default_factory=frozenset)
    memberships: tuple[Membership, ...] = ()
    team_tree: tuple[TeamNode, ...] = ()
    #: Papel na organizacao, que nao depende de time. `None` = nenhum.
    org_role: str | None = None

    def has_role(self, role: str) -> bool:
        """Papel no workspace, de time ou de organizacao (o ADMIN de
        organizacao nao tem time)."""
        return role in self.roles or role == self.org_role

    def has_permission_in(
        self, permission: str, team_id: uuid.UUID | None
    ) -> bool:
        """Tem esta permissao naquele time? A pergunta do servico, que ja
        conhece o alvo; `has_permission` e a do portao de rota.

        Contexto sem escopo (`frozenset`) cai para a pergunta ampla (fail-open).
        """
        can_in = getattr(self.permissions, "can_in", None)
        if can_in is None:
            return self.has_permission(permission)
        return bool(can_in(permission, team_id))

    def teams_with_permission(
        self, permission: str
    ) -> frozenset[uuid.UUID] | None:
        """Em quais times tem esta permissao? `None` = todos.

        Para filtrar listas. Contexto sem escopo responde `None` se tiver a
        permissao em algum lugar (mesmo fail-open de `has_permission_in`).
        """
        teams_with = getattr(self.permissions, "teams_with", None)
        if teams_with is None:
            return None if self.has_permission(permission) else frozenset()
        return teams_with(permission)

    def has_permission(self, permission: str) -> bool:
        """Tem a permissao em algum lugar? Nao lanca."""
        return permission in self.permissions


_tenant_ctx: ContextVar[TenantContext | None] = ContextVar(
    "tenant_context", default=None
)


def set_tenant(context: TenantContext) -> Token[TenantContext | None]:
    """Seta o contexto de tenant. Em jobs, prefira `tenant_scope()`, que faz o reset."""
    return _tenant_ctx.set(context)


def current_tenant() -> TenantContext | None:
    """Retorna o contexto corrente, ou None se nao houver."""
    return _tenant_ctx.get()


def can_in(permission: str, team_id: uuid.UUID | None) -> bool:
    """O verbo no time do item, sem lancar: os schemas (`can_update`...) usam
    para a tela saber se mostra o botao. Le so o contexto (sem N+1); sem
    contexto, False.
    """
    tenant = _tenant_ctx.get()
    return tenant is not None and tenant.has_permission_in(permission, team_id)


def require_tenant() -> TenantContext:
    """Contexto corrente; sem ele, MissingTenantContextError (e bug de quem chamou)."""
    context = _tenant_ctx.get()
    if context is None:
        raise MissingTenantContextError(
            "Operacao requer contexto de tenant. Nenhum workspace "
            "ativo na requisicao/job corrente."
        )
    return context


@contextmanager
def tenant_scope(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    roles: frozenset[str] | None = None,
    permissions: frozenset[str] | Any | None = None,
    memberships: tuple[Membership, ...] = (),
    team_tree: tuple[TeamNode, ...] = (),
    org_role: str | None = None,
) -> Iterator[TenantContext]:
    """Seta o tenant em jobs e scripts, com reset garantido ao sair."""
    context = TenantContext(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=roles or frozenset(),
        permissions=permissions or frozenset(),
        memberships=memberships,
        team_tree=team_tree,
        org_role=org_role,
    )
    token = _tenant_ctx.set(context)
    try:
        yield context
    finally:
        _tenant_ctx.reset(token)
