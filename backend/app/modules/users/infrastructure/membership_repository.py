"""Acesso a dados para montar a WorkspaceMembership.

Roda antes de o TenantContext existir, entao nao usa o BaseRepository:
escopa por workspace_id a mao.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Team, User, UserTeam
from app.modules.users.domain.membership import WorkspaceMembership


class MembershipRepository:
    """Monta a WorkspaceMembership de um usuario a partir do banco."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_membership(
        self, *, user_id: uuid.UUID, workspace_id: uuid.UUID
    ) -> WorkspaceMembership | None:
        """Carrega o vinculo do usuario com o workspace; None se nao for dele."""
        user = await self._session.get(User, user_id)
        if user is None or user.workspace_id != workspace_id:
            return None

        roles_stmt = select(UserTeam.team_id, UserTeam.role).where(
            UserTeam.user_id == user_id,
            UserTeam.workspace_id == workspace_id,
        )
        rows = (await self._session.execute(roles_stmt)).all()
        team_roles = tuple((team_id, role.value) for team_id, role in rows)
        roles = frozenset(role for _, role in team_roles)

        return WorkspaceMembership(
            user_id=user_id,
            workspace_id=workspace_id,
            roles=roles,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            token_version=user.token_version,
            team_roles=team_roles,
            org_role=user.org_role.value if user.org_role is not None else None,
        )

    async def get_memberships(
        self, *, user_ids: list[uuid.UUID], workspace_id: uuid.UUID
    ) -> dict[uuid.UUID, WorkspaceMembership]:
        """O `get_membership` para varias pessoas, em duas consultas.

        Quem nao existe ou e de outro workspace nao aparece no dicionario.
        """
        ids = list(dict.fromkeys(user_ids))
        if not ids:
            return {}
        users = (
            await self._session.execute(
                select(User).where(
                    User.id.in_(ids), User.workspace_id == workspace_id
                )
            )
        ).scalars().all()
        if not users:
            return {}
        rows = (
            await self._session.execute(
                select(UserTeam.user_id, UserTeam.team_id, UserTeam.role).where(
                    UserTeam.user_id.in_([u.id for u in users]),
                    UserTeam.workspace_id == workspace_id,
                )
            )
        ).all()
        papeis: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {}
        for user_id, team_id, role in rows:
            papeis.setdefault(user_id, []).append((team_id, role.value))

        resultado: dict[uuid.UUID, WorkspaceMembership] = {}
        for user in users:
            team_roles = tuple(papeis.get(user.id, ()))
            resultado[user.id] = WorkspaceMembership(
                user_id=user.id,
                workspace_id=workspace_id,
                roles=frozenset(role for _, role in team_roles),
                is_active=user.is_active,
                must_change_password=user.must_change_password,
                token_version=user.token_version,
                team_roles=team_roles,
                org_role=user.org_role.value if user.org_role is not None else None,
            )
        return resultado

    async def load_team_tree(
        self, *, workspace_id: uuid.UUID
    ) -> tuple[tuple[uuid.UUID, uuid.UUID | None], ...]:
        """Carrega (team_id, parent_team_id) de todos os times do workspace."""
        stmt = select(Team.id, Team.parent_team_id).where(
            Team.workspace_id == workspace_id
        )
        rows = (await self._session.execute(stmt)).all()
        return tuple((team_id, parent_id) for team_id, parent_id in rows)
