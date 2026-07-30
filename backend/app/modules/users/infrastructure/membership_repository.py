"""Acesso a dados para montar a WorkspaceMembership.

Este repository e um caso especial: ele roda DURANTE a
resolucao da autenticacao, ANTES de o TenantContext existir.
Por isso NAO usa o BaseRepository (que exige contexto de
tenant) -- ele consulta diretamente pela sessao, escopando
manualmente por workspace_id.

E o unico repository autorizado a fazer isso, pela mesma
razao do AuthService: a auth precisa descobrir o tenant
antes que o tenant possa existir.
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
        """Carrega o vinculo do usuario com o workspace.

        Retorna None se o usuario nao existir ou nao pertencer
        ao workspace informado.

        Passos:
          1. confirma que o usuario existe e e do workspace;
          2. coleta os papeis (roles) das equipes do usuario
             NAQUELE workspace -- a partir de user_team.
        """
        # (1) usuario do workspace
        user = await self._session.get(User, user_id)
        if user is None or user.workspace_id != workspace_id:
            return None

        # (2) papeis do usuario nas equipes do workspace
        roles_stmt = select(UserTeam.team_id, UserTeam.role).where(
            UserTeam.user_id == user_id,
            UserTeam.workspace_id == workspace_id,
        )
        rows = (await self._session.execute(roles_stmt)).all()
        # role e o enum UserTeamRole; .value normaliza para str
        team_roles = tuple((team_id, role.value) for team_id, role in rows)
        roles = frozenset(role for _, role in team_roles)

        return WorkspaceMembership(
            user_id=user_id,
            workspace_id=workspace_id,
            roles=roles,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            # Spec 030: NENHUMA query nova -- a linha do usuario ja veio no
            # session.get() acima, que existe desde sempre para is_active.
            token_version=user.token_version,
            team_roles=team_roles,
        )

    async def load_team_tree(
        self, *, workspace_id: uuid.UUID
    ) -> tuple[tuple[uuid.UUID, uuid.UUID | None], ...]:
        """Carrega (team_id, parent_team_id) de todos os times do workspace.

        Roda pre-contexto (mesma razao do get_membership). A arvore e
        pequena; um SELECT simples basta. Alimenta o team_scope.
        """
        stmt = select(Team.id, Team.parent_team_id).where(
            Team.workspace_id == workspace_id
        )
        rows = (await self._session.execute(stmt)).all()
        return tuple((team_id, parent_id) for team_id, parent_id in rows)
