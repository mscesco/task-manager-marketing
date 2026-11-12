"""Models da Base, a tabela que a equipe monta: base, base_column, base_row,
base_view e base_change (diario do desfazer).

Os valores da linha sao guardados pelo id da coluna, e a celula de opcao
guarda o id da opcao: renomear nao toca linha nenhuma.

Sem `TimestampMixin`/`SoftDeleteMixin` porque eles trazem `comment` de coluna
que a migration nao tem. Nomes de unique e indice iguais aos da migration (o
autogenerate compara pelo nome).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import UUIDPrimaryKeyMixin, workspace_fk_column

#: Tipos de coluna (lista fechada, espelhada no CHECK).
COLUMN_TYPES: tuple[str, ...] = (
    "title",
    "text",
    "number",
    "date",
    "select",
    "multi_select",
    "person",
    "link",
    "checkbox",
)

VIEW_LAYOUTS: tuple[str, ...] = ("table", "calendar", "board")


def _in(valores: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in valores)


def _agora() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


def _quando_opcional() -> Mapped[datetime | None]:
    return mapped_column(DateTime(timezone=True), nullable=True)


class BaseTable(UUIDPrimaryKeyMixin, Base):
    """A base. `team_id` e sempre um time raiz, garantido pelo servico
    (`BaseService.create`), nao pelo banco. `Base` ja e a declarativa."""

    __tablename__ = "base"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_base_id_workspace"),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="fk_base_team",
        ),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="fk_base_created_by",
        ),
        Index("ix_base_workspace_team", "workspace_id", "team_id"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    team_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Texto livre do topo, em Markdown.
    description: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = _agora()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    #: Fica 10 dias recuperavel; depois a rotina diaria apaga de vez.
    deleted_at: Mapped[datetime | None] = _quando_opcional()
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )


class BaseColumn(UUIDPrimaryKeyMixin, Base):
    """Uma coluna. `options` e a lista de `{id, label, color, deleted_at}` dos
    tipos de selecao; a celula guarda o `id` da opcao."""

    __tablename__ = "base_column"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_base_column_id_workspace"),
        ForeignKeyConstraint(
            ["base_id", "workspace_id"],
            ["base.id", "base.workspace_id"],
            ondelete="CASCADE",
            name="fk_base_column_base",
        ),
        CheckConstraint(f"type IN ({_in(COLUMN_TYPES)})", name="type"),
        Index("ix_base_column_base", "base_id"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    base_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    options: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Sobe a cada gravacao; o conflito do desfazer le isto.
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )
    deleted_at: Mapped[datetime | None] = _quando_opcional()
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )


class BaseRow(UUIDPrimaryKeyMixin, Base):
    """Uma linha. `values` e `{id da coluna (texto): valor}`.

    Editar uma celula grava so aquela chave (`values || {col: valor}`): duas
    pessoas em celulas diferentes nao se atropelam.
    """

    __tablename__ = "base_row"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_base_row_id_workspace"),
        ForeignKeyConstraint(
            ["base_id", "workspace_id"],
            ["base.id", "base.workspace_id"],
            ondelete="CASCADE",
            name="fk_base_row_base",
        ),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="fk_base_row_created_by",
        ),
        Index("ix_base_row_base", "base_id"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    base_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    values: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = _agora()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = _quando_opcional()
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )


class BaseView(UUIDPrimaryKeyMixin, Base):
    """Visao salva e compartilhada. `config` guarda filtros, ordenacao,
    agrupamento, coluna de data e colunas visiveis.

    `is_default`: a visao de tabela com que a base nasce, que nao se apaga
    (uma por base, pelo indice parcial).
    """

    __tablename__ = "base_view"
    __table_args__ = (
        ForeignKeyConstraint(
            ["base_id", "workspace_id"],
            ["base.id", "base.workspace_id"],
            ondelete="CASCADE",
            name="fk_base_view_base",
        ),
        CheckConstraint(f"layout IN ({_in(VIEW_LAYOUTS)})", name="layout"),
        Index("ix_base_view_base", "base_id"),
        Index(
            "uq_base_view_um_padrao",
            "base_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    base_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    layout: Mapped[str] = mapped_column(String(10), nullable=False)
    config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )


class BaseChange(UUIDPrimaryKeyMixin, Base):
    """Diario de acoes: o que cada pessoa fez, com o valor de antes, para o
    Ctrl+Z rodar ao contrario. A rotina diaria apaga o que passou de 1 dia."""

    __tablename__ = "base_change"
    __table_args__ = (
        ForeignKeyConstraint(
            ["base_id", "workspace_id"],
            ["base.id", "base.workspace_id"],
            ondelete="CASCADE",
            name="fk_base_change_base",
        ),
        ForeignKeyConstraint(
            ["actor_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="fk_base_change_actor",
        ),
        Index("ix_base_change_pilha", "base_id", "actor_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    base_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = _agora()
    undone_at: Mapped[datetime | None] = _quando_opcional()
