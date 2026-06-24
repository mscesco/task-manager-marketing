"""Repository da entidade Project.

Project possui workspace_id; herda o BaseRepository com filtro
automatico de tenant e de soft delete. As queries de listagem
usam o list_page do base (com `filters` adicionais injetados pelo
service). Queries especificas de projeto vivem aqui.
"""

from __future__ import annotations

import uuid

from app.db.models import Project
from app.db.repository import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    """Acesso a dados de projetos, escopado ao tenant corrente."""

    model = Project

    async def get_personal_by_user(self, user_id: uuid.UUID) -> Project | None:
        """Retorna o projeto pessoal do `user_id` no workspace corrente.

        None se nao existir (cenario que NAO deveria ocorrer apos a
        migration 0002, mas tratamos defensivamente -- a criacao do
        pessoal acontece no provisioning e no cadastro de membro).

        Garantia de unicidade vem do indice parcial
        `project_personal_per_user` (ver migration 0002).
        """
        stmt = (
            self._base_select()
            .where(Project.is_personal.is_(True))
            .where(Project.created_by == user_id)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
