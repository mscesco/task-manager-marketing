"""Monta o TenantContext de uma pessoa: o do login, o da chave de API e o do
dono de um webhook (conferido de novo na hora de enviar)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import Membership, TeamNode, TenantContext
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.users.infrastructure.membership_repository import (
    MembershipRepository,
)


async def montar_contexto(
    repo: MembershipRepository,
    membership,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    via_api_key: bool = False,
) -> TenantContext:
    """Permissao = papeis de time (com o time) + papel de organizacao (sem time)."""
    memberships = tuple(
        Membership(team_id=team_id, role=role)
        for team_id, role in membership.team_roles
    )
    tree_rows = await repo.load_team_tree(workspace_id=workspace_id)
    team_tree = tuple(
        TeamNode(team_id=tid, parent_team_id=pid) for tid, pid in tree_rows
    )
    return TenantContext(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=membership.roles,
        permissions=permissions_for_actor(
            memberships=memberships, tree=team_tree, org_role=membership.org_role
        ),
        memberships=memberships,
        team_tree=team_tree,
        org_role=membership.org_role,
        via_api_key=via_api_key,
    )


async def contexto_da_pessoa_ativa(
    session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> TenantContext | None:
    """O contexto de quem ainda esta no workspace e ativo; senao `None`."""
    repo = MembershipRepository(session)
    membership = await repo.get_membership(user_id=user_id, workspace_id=workspace_id)
    if membership is None or not membership.is_active:
        return None
    return await montar_contexto(repo, membership, user_id=user_id, workspace_id=workspace_id)
