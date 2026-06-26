"""Repository de usuarios (membros do workspace).

User possui workspace_id, entao herda o BaseRepository --
queries ja filtradas pelo tenant. Cobre tambem o vinculo
user<->team (tabela user_team), que e como um membro recebe
um papel dentro de uma equipe.

Para queries sobre UserTeam (que nao e o `model` deste
repository) usamos `require_tenant()` diretamente, obtendo
o workspace_id e filtrando de forma explicita.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.tenant import require_tenant
from app.db.models import Team, User, UserTeam
from app.db.models.enums import UserTeamRole
from app.db.repository import BaseRepository


class UserRepository(BaseRepository[User]):
    """Acesso a dados de usuarios, escopado ao tenant corrente."""

    model = User

    async def email_exists(self, email: str) -> bool:
        """True se ja existe um usuario com este e-mail no workspace.

        O schema tem UNIQUE(workspace_id, email); antecipamos
        o conflito com mensagem de dominio clara. Considera
        tambem usuarios soft-deleted: o e-mail continua
        reservado por causa da constraint UNIQUE.
        """
        stmt = (
            self._base_select(include_deleted=True)
            .with_only_columns(User.id)
            .where(User.email == email)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[User]:
        """Lista todos os usuarios ativos do workspace, por nome."""
        stmt = self._base_select().order_by(User.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_all_with_subteam(
        self,
    ) -> list[tuple[User, uuid.UUID | None]]:
        """Lista os membros (mesmos de list_all) + o id do SUBTIME de cada um.

        Subtime = time com parent_team_id != NULL. O time PRINCIPAL (raiz)
        e ignorado DE PROPOSITO: quem esta na raiz (ex.: managers do seed)
        nao deve ser rotulado com o id do Marketing geral, senao o filtro
        de subtime no quadro (Fatia 3) perde o sentido.

        Pelo invariante "um subtime por usuario" (ADR 0008), o LEFT JOIN
        com a subconsulta de subtimes devolve no MAXIMO uma linha por
        membro -- entao nao ha duplicacao mesmo para quem esta em raiz +
        subtime. Membro sem subtime vem com None.

        Tenant: a subconsulta filtra UserTeam.workspace_id explicitamente;
        o _base_select() ja escopa o User. Sem cruzamento entre tenants.
        """
        workspace_id = require_tenant().workspace_id
        # (user_id -> subteam_id) apenas para vinculos com time NAO-raiz.
        subteam = (
            select(
                UserTeam.user_id.label("user_id"),
                UserTeam.team_id.label("subteam_id"),
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
            .subquery()
        )
        stmt = (
            self._base_select()
            .add_columns(subteam.c.subteam_id)
            .outerjoin(subteam, subteam.c.user_id == User.id)
            .order_by(User.name)
        )
        result = await self.session.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    # ----------------------------------------------------
    # Vinculo user <-> team (papeis)
    # ----------------------------------------------------
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
        """Cria o vinculo user<->team com um papel. Nao faz commit.

        O workspace_id vem do tenant corrente -- o chamador nao
        precisa (nem deve) passa-lo.
        """
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
        """Remove (hard delete) um vinculo user<->team. Nao faz commit.

        UserTeam e pivot sem soft delete -- a remocao e fisica. O commit e
        do Unit of Work. Spec 015, Fatia 4.
        """
        await self.session.delete(membership)

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
