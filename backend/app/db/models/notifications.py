"""Models de notificacao in-app e dos toggles desligados.

`type` e String (tipo novo sem ALTER TYPE). `payload` guarda um retrato para
exibir, tirado na emissao, para o sino ler uma tabela so. `task_id`,
`comment_id` e `actor_id` sem FK: o aviso sobrevive ao alvo sumir. Avisos
seguidos do mesmo autor se juntam (`NotificationEmitter._juntar`).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import UUIDPrimaryKeyMixin


class Notification(UUIDPrimaryKeyMixin, Base):
    """Notificacao in-app entregue a um recipient. Append + mark-read."""

    __tablename__ = "notification"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipient_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="fk_notification_recipient",
        ),
        # Ordenacao do sino e da pagina "Todas".
        Index(
            "ix_notification_recipient_updated",
            "recipient_id",
            text("updated_at DESC"),
            text("id DESC"),
        ),
        # COMMENT da tabela no banco; o dict de opcoes vai por ultimo.
        {
            "comment": (
                "Notificacoes in-app pessoais (Spec 018). type via String; "
                "payload JSONB com snapshot de exibicao; "
                "task_id/comment_id/actor_id sem FK (registro historico que "
                "sobrevive a task/comentario sumir)."
            )
        },
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Ultima mudanca do aviso (uma juncao atualiza); o sino ordena por aqui.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Por que o aviso chegou (`watcher`, `assignee`, `creator`), gravado no
    # envio. Vazio = sem papel, e nunca e silenciado por toggle de papel.
    roles: Mapped[list[str]] = mapped_column(
        ARRAY(String(10)),
        server_default=text("'{}'::character varying[]"),
        nullable=False,
    )


class NotificationMute(UUIDPrimaryKeyMixin, Base):
    """Toggle de notificacao desligado: linha = desligado, ausencia = ligado
    (tipo novo ja nasce ligado). `role = "none"` e o toggle sem papel.
    """

    __tablename__ = "notification_mute"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="notification_mute_user",
        ),
        UniqueConstraint(
            "user_id", "type", "role", name="uq_notification_mute_user_type_role"
        ),
        CheckConstraint(
            "role IN ('watcher', 'assignee', 'creator', 'none')",
            name="ck_notification_mute_role",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
