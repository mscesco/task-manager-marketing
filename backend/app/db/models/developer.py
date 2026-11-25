"""Acesso de fora pela API (Spec 065): chaves de API de cada pessoa."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import UUIDPrimaryKeyMixin


class ApiKey(UUIDPrimaryKeyMixin, Base):
    """Chave de API: age como a pessoa que a criou. Guarda só o hash da chave."""

    __tablename__ = "api_key"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="api_key_user",
        ),
        Index("ix_api_key_user", "user_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: O começo da chave (`tm_a1b2c3d`), para a pessoa reconhecer qual é.
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    #: sha256 da chave inteira, em hex.
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    read_only: Mapped[bool] = mapped_column(Boolean, nullable=False)
    #: `None` = sem validade.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
