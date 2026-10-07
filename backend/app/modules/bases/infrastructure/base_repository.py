"""Acesso a dados da Base (Spec 056). Tudo pelo `BaseRepository`: o filtro de
tenant e o de `deleted_at` ja vem de `_base_select()`."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select, update

from app.db.models.bases import BaseColumn, BaseRow, BaseTable, BaseView
from app.db.repository import BaseRepository


class BaseTableRepository(BaseRepository[BaseTable]):
    model = BaseTable

    async def list_in_teams(
        self, team_ids: frozenset[uuid.UUID] | None
    ) -> list[BaseTable]:
        """As bases vivas dos times dados; `None` = de todos (a organizacao)."""
        stmt = self._base_select().order_by(BaseTable.name, BaseTable.id)
        if team_ids is not None:
            if not team_ids:
                return []
            stmt = stmt.where(BaseTable.team_id.in_(team_ids))
        return list((await self.session.execute(stmt)).scalars().all())


class BaseColumnRepository(BaseRepository[BaseColumn]):
    model = BaseColumn

    async def list_for(self, base_id: uuid.UUID) -> list[BaseColumn]:
        stmt = (
            self._base_select()
            .where(BaseColumn.base_id == base_id)
            .order_by(BaseColumn.position, BaseColumn.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_in(self, base_id: uuid.UUID, column_id: uuid.UUID) -> BaseColumn | None:
        stmt = self._base_select().where(
            BaseColumn.base_id == base_id, BaseColumn.id == column_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def next_position(self, base_id: uuid.UUID) -> int:
        """Depois da ultima -- contando as apagadas, para o desfazer devolver a
        coluna ao lugar dela sem colidir."""
        stmt = select(func.coalesce(func.max(BaseColumn.position), 0)).where(
            self._tenant_clause(), BaseColumn.base_id == base_id
        )
        return int((await self.session.execute(stmt)).scalar_one()) + 1


class BaseViewRepository(BaseRepository[BaseView]):
    model = BaseView

    async def list_for(self, base_id: uuid.UUID) -> list[BaseView]:
        stmt = (
            self._base_select()
            .where(BaseView.base_id == base_id)
            .order_by(BaseView.position, BaseView.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())


class BaseRowRepository(BaseRepository[BaseRow]):
    model = BaseRow

    async def clear_column(self, base_id: uuid.UUID, column_id: uuid.UUID) -> int:
        """Tira a chave da coluna de toda linha que a tem (troca de tipo, D18).

        ⚠️ SO A CHAVE (`values - 'col'`), e nao a linha: as outras celulas ficam.
        `version` sobe em cada linha tocada -- e uma gravacao como qualquer outra.
        Devolve quantas linhas mudaram.
        """
        chave = str(column_id)
        stmt = (
            update(BaseRow)
            .where(
                self._tenant_clause(),
                BaseRow.base_id == base_id,
                BaseRow.values.has_key(chave),
            )
            .values(values=BaseRow.values.op("-")(chave), version=BaseRow.version + 1)
            .execution_options(synchronize_session=False)
        )
        resultado = await self.session.execute(stmt)
        return int(resultado.rowcount or 0)
