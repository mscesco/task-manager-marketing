"""Mixins de colunas comuns dos models.

Defaults ficam no banco (`server_default`), para INSERT fora do ORM valer.
`updated_at` nao tem trigger: quem atualiza e o `onupdate` do ORM.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column


class UUIDPrimaryKeyMixin:
    """PK UUID com default gerado pelo banco (gen_random_uuid)."""

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )


class TimestampMixin:
    """created_at / updated_at (este pelo `onupdate` do ORM)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        # Igual ao COMMENT do banco. `Solicitation` redeclara a coluna sem
        # comment porque no banco dela ele nao existe.
        comment=(
            "Nao atualiza sozinho. Setado pelo backend via "
            "SQLAlchemy onupdate."
        ),
    )


class SoftDeleteMixin:
    """Soft delete: NULL = ativo. O BaseRepository filtra sozinho."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
        comment=(
            "Soft delete real. NULL = ativo. Queries operacionais "
            "filtram deleted_at IS NULL."
        ),
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class ArchivableMixin:
    """Arquivado nao e apagado. O filtro depende da tela; o repository nao aplica."""

    is_archived: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default="false",
        default=False,
        comment=(
            "Ocultacao operacional, NAO e delecao. Entidade segue "
            "valida; archived != deleted."
        ),
    )


def workspace_fk_column() -> Mapped[uuid.UUID]:
    """`workspace_id` com FK, sem indice: difere do `WorkspaceScopedMixin` so
    nisso. Essas tabelas sao consultadas pela tarefa ou pela base; trocar pelo
    mixin criaria indices (uma migration).
    """
    return mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )


class WorkspaceScopedMixin:
    """Coluna de tenant, usada pelo BaseRepository. FKs compostas
    (id, workspace_id) ficam em cada model."""

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
