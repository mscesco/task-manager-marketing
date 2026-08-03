"""Model ORM de notificacoes in-app (Spec 018).

notification : eventos pessoais entregues a um destinatario (recipient).
Tipos iniciais: TASK_ASSIGNED, TASK_COMMENTED. A tabela e generica o
suficiente para tipos futuros (mencao, prazo) sem rework.

Decisoes (Spec 018):
  - `type` e String (nao PG enum): tipo novo nao exige ALTER TYPE.
  - `payload` JSONB carrega snapshot de exibicao (ex.: actor_name,
    task_title) capturado na EMISSAO -> read vira scan de UMA tabela,
    barato pro poll do sino (D1).
  - `task_id`/`comment_id`/`actor_id` SEM FK rigida: a notificacao e um
    registro historico que sobrevive a task/comentario sumir (D2).
  - `recipient_id` TEM FK composta (id, workspace_id) -> users: um
    destinatario invalido nao faz sentido.
  - sem soft-delete, sem updated_at: notificacao nasce e so muda read_at.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
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
        # COMMENT da TABELA no schema v5 (dict de opcoes vai por ULTIMO).
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
