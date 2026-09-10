"""Repository da entidade Project.

Project possui workspace_id; herda o BaseRepository com filtro
automatico de tenant e de soft delete. As queries de listagem
usam o list_page do base (com `filters` adicionais injetados pelo
service). Queries especificas de projeto vivem aqui.
"""

from __future__ import annotations

from app.db.models import Project
from app.db.repository import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    """Acesso a dados de projetos, escopado ao tenant corrente."""

    model = Project
