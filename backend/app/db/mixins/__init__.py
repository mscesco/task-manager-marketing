"""Mixins reutilizaveis para os models ORM.

Cada mixin reflete um padrao JA presente no schema_v5.sql.
Eles existem para que os models nao repitam as mesmas
colunas, e para garantir consistencia com o banco.

IMPORTANTE sobre defaults e o banco:
    O schema v5 ja define DEFAULT gen_random_uuid() e
    DEFAULT now() no proprio Postgres. Os mixins replicam
    isso com `server_default`, de modo que:
        - o banco continua sendo a fonte da verdade do default;
        - INSERTs feitos fora do ORM (psql, N8N) seguem validos.
    `updated_at` NAO tem trigger no banco (decisao do schema:
    "setado pelo backend via SQLAlchemy onupdate") -- por isso
    usamos `onupdate=now()` no lado do ORM.
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
    """created_at / updated_at, alinhados ao schema v5.

    created_at : server_default now(), imutavel.
    updated_at : server_default now() + onupdate no lado ORM
                 (o banco NAO tem trigger; e o backend que seta).
    """

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
        # COMMENT do schema v5. Declarado aqui pra o autogenerate nao
        # propor apagar a documentacao que esta no banco.
        # ⚠️ `solicitation` usa este mixin e NAO tem o comment no banco
        # (0005 foi escrita a mao e esqueceu) -- por isso o model
        # Solicitation redeclara updated_at sem comment.
        comment=(
            "Nao atualiza sozinho. Setado pelo backend via "
            "SQLAlchemy onupdate."
        ),
    )


class SoftDeleteMixin:
    """deleted_at -- soft delete real.

    NULL = ativo. Queries operacionais DEVEM filtrar
    deleted_at IS NULL. O BaseRepository aplica esse filtro
    automaticamente (ver app.db.repository).
    """

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
    """is_archived -- ocultacao operacional reversivel.

    archived != deleted. Arquivar nao remove a entidade; ela
    segue valida. O filtro de is_archived depende da tela e
    NAO e aplicado automaticamente pelo repository.
    """

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


class WorkspaceScopedMixin:
    """workspace_id NOT NULL -- coluna de tenant.

    Presente em toda tabela operacional do schema v5. A FK
    para workspace(id) com ON DELETE RESTRICT tambem e
    declarada aqui. As FKs COMPOSTAS (id, workspace_id) das
    demais relacoes sao declaradas em cada model, pois variam
    de tabela para tabela.

    A presenca desta coluna e o que permite ao BaseRepository
    aplicar o predicado de tenant automaticamente.
    """

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
