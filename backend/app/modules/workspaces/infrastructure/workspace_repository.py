"""Repository da entidade Workspace.

Nao usa o BaseRepository (a tabela nao tem `workspace_id`): escopa pelo id
do workspace do TenantContext.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Workspace
from app.shared.exceptions.base import EntityNotFoundError


class WorkspaceRepository:
    """Acesso a dados do workspace do tenant corrente."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_current(self) -> Workspace:
        """Carrega o workspace do TenantContext ativo."""
        tenant = require_tenant()
        workspace = await self.session.get(Workspace, tenant.workspace_id)
        if workspace is None:
            raise EntityNotFoundError(
                "Workspace", identifier=tenant.workspace_id
            )
        return workspace
