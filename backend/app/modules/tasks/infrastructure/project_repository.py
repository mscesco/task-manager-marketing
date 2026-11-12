"""Repository de Project (tenant e soft delete filtrados pelo BaseRepository)."""

from __future__ import annotations

import uuid

from app.db.models import Project
from app.db.repository import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    """Acesso a dados de projetos, escopado ao tenant corrente."""

    model = Project

    async def get_many_by_ids(
        self, ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Project]:
        """O `get_by_id` para varios ids, numa consulta: `id -> projeto`.

        Mesmo filtro (tenant + soft delete): o id que nao volta e o `None`
        do irmao, so que por ausencia.
        """
        if not ids:
            return {}
        rows = await self.session.execute(
            self._base_select().where(Project.id.in_(ids))
        )
        return {p.id: p for p in rows.scalars().all()}
