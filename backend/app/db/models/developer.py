"""Acesso de fora pela API (Spec 065): chaves de API e webhooks de cada pessoa."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


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


class Webhook(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Avisa uma URL de fora quando algo acontece num time (e quadro) que a dona vê."""

    __tablename__ = "webhook"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="webhook_user",
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="CASCADE",
            name="webhook_team",
        ),
        ForeignKeyConstraint(
            ["board_id", "workspace_id"],
            ["board.id", "board.workspace_id"],
            ondelete="CASCADE",
            name="webhook_board",
        ),
        Index("ix_webhook_workspace", "workspace_id"),
        Index("ix_webhook_user", "user_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    #: Recebe os eventos deste time e dos subtimes dele.
    team_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    #: Só os eventos de tarefa deste quadro. `None` = qualquer quadro.
    board_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    #: Chave do HMAC da assinatura (`X-TM-Signature`).
    secret: Mapped[str] = mapped_column(String(64), nullable=False)
    events: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )


class WebhookDelivery(UUIDPrimaryKeyMixin, Base):
    """Uma tentativa de entrega. Ficam só as últimas de cada webhook."""

    __tablename__ = "webhook_delivery"
    __table_args__ = (Index("ix_webhook_delivery_webhook_at", "webhook_id", "delivered_at"),)

    webhook_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("webhook.id", ondelete="CASCADE"),
        nullable=False,
    )
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    #: `None` = nem chegou a responder (rede, tempo, endereço recusado).
    status_code: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(String(300))
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    delivered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
