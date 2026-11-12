"""BaseRepository: toda query ja nasce filtrada pelo tenant corrente (do
ContextVar) e por soft delete; sem tenant, falha em vez de vazar dados.

Subclasse nunca monta SELECT sem passar por `_base_select()`.
"""

from __future__ import annotations

import uuid
from typing import Any, Generic, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.tenant import require_tenant
from app.db.base import Base
from app.shared.exceptions.base import EntityNotFoundError
from app.shared.pagination import Page, PageParams

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """Repositorio generico do tenant corrente. Nunca faz commit (e do Unit of Work)."""

    model: type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        if not hasattr(self, "model"):
            raise TypeError(
                f"{type(self).__name__} deve definir o atributo de classe `model`."
            )
        if not hasattr(self.model, "workspace_id"):
            raise TypeError(
                f"{self.model.__name__} nao tem workspace_id; "
                "use um repositorio dedicado, nao o BaseRepository."
            )
        self.session = session

    def _base_select(self, *, include_deleted: bool = False) -> Select[tuple[ModelT]]:
        """SELECT filtrado por tenant e soft delete; toda consulta parte daqui."""
        tenant = require_tenant()
        stmt = select(self.model).where(
            self.model.workspace_id == tenant.workspace_id
        )
        if not include_deleted and hasattr(self.model, "deleted_at"):
            stmt = stmt.where(self.model.deleted_at.is_(None))
        return stmt

    def _tenant_clause(self) -> ColumnElement[bool]:
        """Predicado de tenant isolado, para queries customizadas
        (ex. agregacoes) que nao usam _base_select."""
        tenant = require_tenant()
        return self.model.workspace_id == tenant.workspace_id

    async def get_by_id(
        self, entity_id: uuid.UUID, *, include_deleted: bool = False
    ) -> ModelT | None:
        """Busca por id dentro do tenant corrente."""
        stmt = self._base_select(include_deleted=include_deleted).where(
            self.model.id == entity_id
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_id_or_raise(
        self, entity_id: uuid.UUID, *, include_deleted: bool = False
    ) -> ModelT:
        """Igual a get_by_id, mas lanca EntityNotFoundError se ausente."""
        entity = await self.get_by_id(entity_id, include_deleted=include_deleted)
        if entity is None:
            raise EntityNotFoundError(self.model.__name__, identifier=entity_id)
        return entity

    async def list_page(
        self,
        params: PageParams,
        *,
        filters: list[ColumnElement[bool]] | None = None,
        order_by: Any | None = None,
    ) -> Page[ModelT]:
        """Listagem paginada; `filters` somam ao filtro de tenant e soft delete."""
        base = self._base_select()
        if filters:
            base = base.where(*filters)

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        page_stmt = base.limit(params.limit).offset(params.offset)
        if order_by is not None:
            page_stmt = page_stmt.order_by(order_by)
        items = list((await self.session.execute(page_stmt)).scalars().all())

        return Page(
            items=items, total=total, page=params.page, size=params.size
        )

    def add(self, entity: ModelT) -> ModelT:
        """Adiciona na sessao, recusando workspace diferente do tenant corrente."""
        tenant = require_tenant()
        obj_ws = getattr(entity, "workspace_id", None)
        if obj_ws is None:
            entity.workspace_id = tenant.workspace_id  # type: ignore[attr-defined]
        elif obj_ws != tenant.workspace_id:
            raise PermissionError(
                "Tentativa de gravar entidade em workspace diferente do "
                "tenant corrente."
            )
        self.session.add(entity)
        return entity

    async def soft_delete(self, entity: ModelT) -> None:
        """Soft delete: marca deleted_at. Exige a coluna no model."""
        if not hasattr(entity, "deleted_at"):
            raise TypeError(
                f"{self.model.__name__} nao suporta soft delete "
                "(sem coluna deleted_at)."
            )
        entity.deleted_at = func.now()  # type: ignore[attr-defined]
        await self.session.flush()
