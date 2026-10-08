"""Acesso a dados da Base (Spec 056). Tudo pelo `BaseRepository`: o filtro de
tenant e o de `deleted_at` ja vem de `_base_select()`."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, func, select, update

from app.db.models.bases import BaseChange, BaseColumn, BaseRow, BaseTable, BaseView
from app.db.repository import BaseRepository


class BaseChangeRepository(BaseRepository[BaseChange]):
    """O diario do desfazer (spec §9). A PILHA e por (base, pessoa)."""

    model = BaseChange

    async def last_to_undo(
        self, base_id: uuid.UUID, actor_id: uuid.UUID, since: datetime
    ) -> BaseChange | None:
        """A acao mais recente da pessoa, ainda nao desfeita, dentro de 1 dia."""
        stmt = (
            self._base_select()
            .where(
                BaseChange.base_id == base_id,
                BaseChange.actor_id == actor_id,
                BaseChange.undone_at.is_(None),
                BaseChange.created_at >= since,
            )
            .order_by(BaseChange.created_at.desc(), BaseChange.id.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def last_to_redo(
        self, base_id: uuid.UUID, actor_id: uuid.UUID, since: datetime
    ) -> BaseChange | None:
        """A ultima desfeita. So existe enquanto a pessoa nao fez nada novo:
        acao nova apaga as desfeitas dela (`drop_undone`)."""
        stmt = (
            self._base_select()
            .where(
                BaseChange.base_id == base_id,
                BaseChange.actor_id == actor_id,
                BaseChange.undone_at.is_not(None),
                BaseChange.created_at >= since,
            )
            .order_by(BaseChange.undone_at.desc(), BaseChange.id.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def drop_undone(self, base_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        """Acao nova da pessoa: o que ela tinha desfeito nao se refaz mais --
        como em qualquer editor."""
        await self.session.execute(
            delete(BaseChange).where(
                self._tenant_clause(),
                BaseChange.base_id == base_id,
                BaseChange.actor_id == actor_id,
                BaseChange.undone_at.is_not(None),
            )
        )

    async def remove(self, change: BaseChange) -> None:
        await self.session.delete(change)
        await self.session.flush()


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

    async def list_deleted_in_teams(
        self, team_ids: frozenset[uuid.UUID] | None, since: datetime
    ) -> list[BaseTable]:
        """A lixeira: excluidas DENTRO do prazo, mais recente primeiro."""
        stmt = (
            self._base_select(include_deleted=True)
            .where(BaseTable.deleted_at.is_not(None), BaseTable.deleted_at >= since)
            .order_by(BaseTable.deleted_at.desc(), BaseTable.id)
        )
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

    async def shift_from(self, base_id: uuid.UUID, position: int) -> None:
        """Empurra uma casa as colunas (vivas e apagadas) de `position` em
        diante -- abre a vaga de "Inserir a esquerda/direita"."""
        await self.session.execute(
            update(BaseColumn)
            .where(
                self._tenant_clause(),
                BaseColumn.base_id == base_id,
                BaseColumn.position >= position,
            )
            .values(position=BaseColumn.position + 1)
            .execution_options(synchronize_session="fetch")
        )

    async def next_position(self, base_id: uuid.UUID) -> int:
        """Depois da ultima -- contando as apagadas, para o desfazer devolver a
        coluna ao lugar dela sem colidir."""
        stmt = select(func.coalesce(func.max(BaseColumn.position), 0)).where(
            self._tenant_clause(), BaseColumn.base_id == base_id
        )
        return int((await self.session.execute(stmt)).scalar_one()) + 1


class BaseViewRepository(BaseRepository[BaseView]):
    model = BaseView

    async def get_in(self, base_id: uuid.UUID, view_id: uuid.UUID) -> BaseView | None:
        stmt = self._base_select().where(
            BaseView.base_id == base_id, BaseView.id == view_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def next_position(self, base_id: uuid.UUID) -> int:
        stmt = select(func.coalesce(func.max(BaseView.position), 0)).where(
            self._tenant_clause(), BaseView.base_id == base_id
        )
        return int((await self.session.execute(stmt)).scalar_one()) + 1

    async def list_for(self, base_id: uuid.UUID) -> list[BaseView]:
        stmt = (
            self._base_select()
            .where(BaseView.base_id == base_id)
            .order_by(BaseView.position, BaseView.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())


class BaseRowRepository(BaseRepository[BaseRow]):
    model = BaseRow

    async def list_for(self, base_id: uuid.UUID) -> list[BaseRow]:
        """Todas as linhas vivas, na ordem em que nasceram. ⚠️ SEM PAGINA, de
        proposito (spec §8.1): filtro e ordenacao acontecem no navegador, e o
        teto de 5.000 por base e o que mantem isso barato."""
        stmt = (
            self._base_select()
            .where(BaseRow.base_id == base_id)
            .order_by(BaseRow.created_at, BaseRow.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_in(
        self, base_id: uuid.UUID, row_id: uuid.UUID, *, include_deleted: bool = False
    ) -> BaseRow | None:
        stmt = self._base_select(include_deleted=include_deleted).where(
            BaseRow.base_id == base_id, BaseRow.id == row_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_many(
        self, base_id: uuid.UUID, row_ids: set[uuid.UUID], *, include_deleted: bool = False
    ) -> dict[uuid.UUID, BaseRow]:
        """As linhas para REGRAVAR `values` -- travadas ate o fim da transacao.

        ⚠️ SEM A TRAVA, DUAS EDICOES NA MESMA LINHA PERDIAM UMA (revisao de
        08/10): quem grava monta o `values` inteiro em Python e devolve; A
        (coluna X) e B (coluna Y) liam a mesma linha velha, e o ultimo commit
        apagava a celula do outro. Com `FOR UPDATE`, B espera o commit de A e
        le a linha ja com X. A ordem por id evita deadlock entre duas colagens
        que pegam as mesmas linhas; `populate_existing` garante que o objeto da
        sessao recebe o valor relido, e nao o que ja estava em memoria.
        """
        if not row_ids:
            return {}
        stmt = (
            self._base_select(include_deleted=include_deleted)
            .where(BaseRow.base_id == base_id, BaseRow.id.in_(row_ids))
            .order_by(BaseRow.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return {r.id: r for r in (await self.session.execute(stmt)).scalars().all()}

    async def count_live(self, base_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(
            self._base_select().where(BaseRow.base_id == base_id).subquery()
        )
        return int((await self.session.execute(stmt)).scalar_one())

    async def copy_column(
        self, base_id: uuid.UUID, origem: uuid.UUID, destino: uuid.UUID
    ) -> None:
        """Copia o valor de `origem` para `destino` em toda linha (viva ou
        apagada) que o tem -- "Duplicar propriedade". So a chave nova entra."""
        de, para = str(origem), str(destino)
        await self.session.execute(
            update(BaseRow)
            .where(
                self._tenant_clause(),
                BaseRow.base_id == base_id,
                BaseRow.values.has_key(de),
            )
            .values(
                values=BaseRow.values.op("||")(
                    func.jsonb_build_object(para, BaseRow.values[de])
                ),
                version=BaseRow.version + 1,
            )
            .execution_options(synchronize_session=False)
        )

    async def values_of_column(
        self, base_id: uuid.UUID, column_id: uuid.UUID
    ) -> dict[str, object]:
        """`{id da linha: valor}` das linhas VIVAS que tem a coluna preenchida --
        o que a troca de tipo apaga, e o diario guarda (D27)."""
        chave = str(column_id)
        stmt = (
            self._base_select()
            .with_only_columns(BaseRow.id, BaseRow.values[chave])
            .where(BaseRow.base_id == base_id, BaseRow.values.has_key(chave))
        )
        return {str(i): v for i, v in (await self.session.execute(stmt)).all()}

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
