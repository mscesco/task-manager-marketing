"""Repository de usuarios e dos vinculos user<->team (papeis).

Consultas sobre `UserTeam` filtram o workspace explicitamente via
`require_tenant()`; o `_base_select` so escopa `User`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by

from app.core.tenant import require_tenant
from app.db.models import Team, User, UserTeam
from app.db.models.enums import OrgRole, UserTeamRole
from app.db.repository import BaseRepository


class UserRepository(BaseRepository[User]):
    """Acesso a dados de usuarios, escopado ao tenant corrente."""

    model = User

    async def email_exists(self, email: str) -> bool:
        """True se o e-mail ja existe no workspace (inclusive inativos).

        Compara sem maiusculas, como o login; a UNIQUE do banco diferencia.
        """
        stmt = (
            self._base_select(include_deleted=True)
            .with_only_columns(User.id)
            .where(func.lower(User.email) == email.strip().lower())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def count_org_admins(self, *, excluindo: uuid.UUID | None = None) -> int:
        """Quantos ADMIN de organizacao ativos (`users.org_role`) ha, para a
        trava do ultimo admin.

        `users` nao tem `deleted_at`: o `_base_select` so filtra tenant, por
        isso o `is_active` explicito.
        """
        # Trava todos os admins antes de contar: dois rebaixamentos simultaneos
        # deixariam a organizacao sem admin. `FOR UPDATE` nao combina com
        # `count()`, entao a conta e em Python.
        stmt = (
            self._base_select()
            .with_only_columns(User.id)
            .where(User.org_role == OrgRole.ADMIN, User.is_active.is_(True))
            .with_for_update()
        )
        ids = (await self.session.execute(stmt)).scalars().all()
        return sum(1 for i in ids if i != excluindo)

    async def list_all_with_subteams(
        self,
    ) -> list[tuple[User, list[uuid.UUID]]]:
        """Os membros + os ids dos SUBTIMES de cada um (sem a raiz, que o filtro
        de subtime do quadro nao pode receber).

        `array_agg` garante uma linha por membro mesmo com varios subtimes;
        ordenado por nome do time. Sem subtime = lista vazia.
        """
        workspace_id = require_tenant().workspace_id
        subteams = (
            select(
                UserTeam.user_id.label("user_id"),
                func.array_agg(
                    aggregate_order_by(UserTeam.team_id, Team.name)
                ).label("subteam_ids"),
            )
            .join(
                Team,
                (Team.id == UserTeam.team_id)
                & (Team.workspace_id == UserTeam.workspace_id),
            )
            .where(
                UserTeam.workspace_id == workspace_id,
                Team.parent_team_id.isnot(None),
            )
            .group_by(UserTeam.user_id)
            .subquery()
        )
        stmt = (
            self._base_select()
            .add_columns(subteams.c.subteam_ids)
            .outerjoin(subteams, subteams.c.user_id == User.id)
            .order_by(User.name)
        )
        result = await self.session.execute(stmt)
        return [(row[0], list(row[1] or ())) for row in result.all()]

    # Vinculo user <-> team
    async def get_team_membership(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> UserTeam | None:
        """Busca o vinculo de um usuario com uma equipe, se existir."""
        workspace_id = require_tenant().workspace_id
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == workspace_id,
            UserTeam.user_id == user_id,
            UserTeam.team_id == team_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    def add_team_membership(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        role: UserTeamRole,
    ) -> UserTeam:
        """Cria o vinculo no workspace do tenant. Nao faz commit."""
        workspace_id = require_tenant().workspace_id
        membership = UserTeam(
            workspace_id=workspace_id,
            user_id=user_id,
            team_id=team_id,
            role=role,
        )
        self.session.add(membership)
        return membership

    async def remove_team_membership(self, membership: UserTeam) -> None:
        """Apaga o vinculo (sem soft delete). Nao faz commit."""
        await self.session.delete(membership)

    async def vinculos_por_membro(
        self,
    ) -> dict[uuid.UUID, list[tuple[uuid.UUID, UserTeamRole]]]:
        """user_id -> [(team_id, papel), ...], todos os vinculos (raiz inclusive),
        em uma consulta, ordenados por nome do time.
        """
        workspace_id = require_tenant().workspace_id
        stmt = (
            select(UserTeam.user_id, UserTeam.team_id, UserTeam.role)
            .join(
                Team,
                (Team.id == UserTeam.team_id)
                & (Team.workspace_id == UserTeam.workspace_id),
            )
            .where(UserTeam.workspace_id == workspace_id)
            .order_by(Team.name)
        )
        out: dict[uuid.UUID, list[tuple[uuid.UUID, UserTeamRole]]] = {}
        for user_id, team_id, role in (await self.session.execute(stmt)).all():
            out.setdefault(user_id, []).append((team_id, role))
        return out

    async def root_team_ids_by_member(self) -> dict[uuid.UUID, list[uuid.UUID]]:
        """user_id -> times raiz onde a pessoa tem vinculo (na raiz ou em
        qualquer descendente), em uma consulta.

        Sobe a arvore recursivamente (ha netos). Quem nao tem vinculo nao
        aparece: use `.get(id, [])`.
        """
        workspace_id = require_tenant().workspace_id
        linhas = (
            await self.session.execute(
                text(
                    """
                    WITH RECURSIVE sobe AS (
                        SELECT ut.user_id, t.id AS team_id, t.parent_team_id
                        FROM user_team ut
                        JOIN team t
                          ON t.id = ut.team_id
                         AND t.workspace_id = ut.workspace_id
                        WHERE ut.workspace_id = :ws
                        UNION ALL
                        SELECT s.user_id, p.id, p.parent_team_id
                        FROM sobe s
                        JOIN team p
                          ON p.id = s.parent_team_id
                         AND p.workspace_id = :ws
                    )
                    SELECT DISTINCT user_id, team_id
                    FROM sobe
                    WHERE parent_team_id IS NULL
                    """
                ),
                {"ws": workspace_id},
            )
        ).all()
        out: dict[uuid.UUID, list[uuid.UUID]] = {}
        for user_id, team_id in linhas:
            out.setdefault(user_id, []).append(team_id)
        return out

    async def list_memberships_of_team(
        self, *, team_id: uuid.UUID
    ) -> list[tuple[UserTeam, bool]]:
        """Os vinculos de um time, com o `is_active` de cada pessoa (um JOIN)."""
        workspace_id = require_tenant().workspace_id
        stmt = (
            select(UserTeam, User.is_active)
            .join(User, User.id == UserTeam.user_id)
            .where(
                UserTeam.workspace_id == workspace_id,
                UserTeam.team_id == team_id,
            )
        )
        result = await self.session.execute(stmt)
        return [(vinculo, ativo) for vinculo, ativo in result.all()]

    async def list_team_memberships(
        self, *, user_id: uuid.UUID
    ) -> list[UserTeam]:
        """Lista todos os vinculos de equipe de um usuario no workspace."""
        workspace_id = require_tenant().workspace_id
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == workspace_id,
            UserTeam.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
