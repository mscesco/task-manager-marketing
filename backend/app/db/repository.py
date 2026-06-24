"""BaseRepository -- acesso a dados centralizado e multi-tenant-safe.

ESTA E A ABSTRACAO MAIS IMPORTANTE DA FOUNDATION.

Resolve a regra do projeto: "multi-tenant NAO pode depender
de lembrar de adicionar filtro manualmente".

Defesa em profundidade -- duas garantias combinadas:

  (1) FILTRO AUTOMATICO: todo SELECT/UPDATE/DELETE construido
      por este repository ja nasce com
          WHERE workspace_id = <tenant corrente>
      O tenant vem do ContextVar (app.core.tenant), nao de
      um parametro -- ninguem precisa lembrar de passa-lo.

  (2) ASSERCAO EXPLICITA: antes de qualquer query, chamamos
      require_tenant(). Se nao houver contexto de tenant, a
      aplicacao FALHA ALTO (MissingTenantContextError) em vez
      de rodar uma query sem filtro e vazar dados.

Alem disso, aplica automaticamente o filtro de soft delete
(deleted_at IS NULL) para models que tenham essa coluna.

Subclasses tipadas (ex. TaskRepository) herdam os metodos
genericos e adicionam apenas queries especificas do dominio.
A subclasse NUNCA deve construir um SELECT sem passar por
`_base_select()`.
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

# Model deve herdar de Base. O contrato de "tem workspace_id"
# e garantido pelos mixins; checamos em runtime no __init__.
ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """Repositorio generico, escopado ao tenant corrente.

    A sessao e injetada (vem do Unit of Work / DI). O
    repository NUNCA faz commit -- isso e responsabilidade
    do Unit of Work. Ele apenas adiciona, consulta e marca
    objetos na sessao.
    """

    #: Subclasses definem o model concreto.
    model: type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        if not hasattr(self, "model"):
            raise TypeError(
                f"{type(self).__name__} deve definir o atributo de classe `model`."
            )
        if not hasattr(self.model, "workspace_id"):
            # Workspace em si nao usa BaseRepository (e a raiz).
            raise TypeError(
                f"{self.model.__name__} nao tem workspace_id; "
                "use um repositorio dedicado, nao o BaseRepository."
            )
        self.session = session

    # ----------------------------------------------------
    # Construcao de queries (ponto unico de filtro)
    # ----------------------------------------------------
    def _base_select(self, *, include_deleted: bool = False) -> Select[tuple[ModelT]]:
        """SELECT base, JA filtrado por tenant e (por padrao) soft delete.

        TODA consulta da subclasse deve partir daqui. Nunca
        escreva `select(self.model)` direto numa subclasse.
        """
        tenant = require_tenant()  # (2) assercao -- falha alto se ausente
        stmt = select(self.model).where(
            self.model.workspace_id == tenant.workspace_id  # (1) filtro automatico
        )
        if not include_deleted and hasattr(self.model, "deleted_at"):
            stmt = stmt.where(self.model.deleted_at.is_(None))
        return stmt

    def _tenant_clause(self) -> ColumnElement[bool]:
        """Predicado de tenant isolado, para queries customizadas
        (ex. agregacoes) que nao usam _base_select."""
        tenant = require_tenant()
        return self.model.workspace_id == tenant.workspace_id

    # ----------------------------------------------------
    # Leitura
    # ----------------------------------------------------
    async def get_by_id(
        self, entity_id: uuid.UUID, *, include_deleted: bool = False
    ) -> ModelT | None:
        """Busca por id DENTRO do tenant corrente. None se nao existir."""
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

    async def exists(self, entity_id: uuid.UUID) -> bool:
        """True se a entidade existe (ativa) no tenant corrente."""
        stmt = (
            self._base_select()
            .with_only_columns(self.model.id)
            .where(self.model.id == entity_id)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_page(
        self,
        params: PageParams,
        *,
        filters: list[ColumnElement[bool]] | None = None,
        order_by: Any | None = None,
    ) -> Page[ModelT]:
        """Listagem paginada, escopada ao tenant.

        `filters` sao predicados ADICIONAIS (o filtro de tenant
        e de soft delete ja vem do _base_select).
        """
        base = self._base_select()
        if filters:
            base = base.where(*filters)

        # Contagem total (mesmo filtro, sem paginacao).
        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        # Pagina de itens.
        page_stmt = base.limit(params.limit).offset(params.offset)
        if order_by is not None:
            page_stmt = page_stmt.order_by(order_by)
        items = list((await self.session.execute(page_stmt)).scalars().all())

        return Page(
            items=items, total=total, page=params.page, size=params.size
        )

    # ----------------------------------------------------
    # Escrita
    # ----------------------------------------------------
    def add(self, entity: ModelT) -> ModelT:
        """Registra um novo objeto na sessao.

        NAO faz commit (isso e do Unit of Work). Valida que o
        workspace_id do objeto bate com o tenant corrente --
        impede inserir dado em outro tenant por engano.
        """
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
