"""Repository da entidade Workspace.

DECISAO: Workspace NAO usa o BaseRepository.

O BaseRepository injeta o filtro `workspace_id = <tenant>`
em toda query -- mas a tabela `workspace` e a RAIZ do
tenant e nao possui a coluna workspace_id. Aplicar o filtro
nela nao faz sentido.

Em vez disso, este repository e escopado pelo PROPRIO id do
workspace corrente: as operacoes so atuam sobre o workspace
do TenantContext ativo. Um usuario so enxerga e edita o
proprio workspace.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Workspace
from app.shared.exceptions.base import EntityNotFoundError


class WorkspaceRepository:
    """Acesso a dados do workspace do tenant corrente."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_current(self) -> Workspace:
        """Carrega o workspace do TenantContext ativo.

        Falha alto (MissingTenantContextError) se nao houver
        tenant -- via require_tenant. Lanca EntityNotFoundError
        se o workspace do token nao existir mais no banco
        (situacao inconsistente).
        """
        tenant = require_tenant()
        workspace = await self.session.get(Workspace, tenant.workspace_id)
        if workspace is None:
            raise EntityNotFoundError(
                "Workspace", identifier=tenant.workspace_id
            )
        return workspace

    async def get_by_id(self, workspace_id: uuid.UUID) -> Workspace | None:
        """Busca um workspace por id. Uso interno/provisionamento."""
        return await self.session.get(Workspace, workspace_id)
