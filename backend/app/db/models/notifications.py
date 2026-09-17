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
  - sem soft-delete. ⚠️ ESTA LINHA DIZIA "sem updated_at: notificacao nasce e
    so muda read_at" -- deixou de ser verdade na Spec 053 (fatia C): avisos
    seguidos do mesmo autor se JUNTAM (payload e `updated_at` mudam) e, quando
    se anulam, a linha e APAGADA. Ver `NotificationEmitter._juntar`.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
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
    # Spec 053, fatia C (migration 0027): a ultima mudanca do aviso. Igual a
    # `created_at` ate uma juncao atualiza-lo. O sino ordena por aqui.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Spec 054 (migration 0028): POR QUE o aviso chegou para quem recebe --
    # `watcher`, `assignee` e/ou `creator`, gravado no instante do envio (D12).
    # Vazio = sem papel: tipos pessoais, ou aviso antigo sem papel reconstruido.
    # ⚠️ Vazio NUNCA e silenciado por toggle de papel (D13).
    roles: Mapped[list[str]] = mapped_column(
        ARRAY(String(10)),
        server_default=text("'{}'::character varying[]"),
        nullable=False,
    )


class NotificationMute(UUIDPrimaryKeyMixin, Base):
    """Um toggle de notificacao DESLIGADO (Spec 054, §6.1).

    ⚠️ UMA LINHA = DESLIGADO, e a ausencia = ligado. E isso que faz tudo nascer
    ligado (D11), inclusive tipo de aviso que ainda nao existe, sem linha para
    ninguem e sem migration.

    `role = "none"` e o toggle de papel unico (reacao; por/tirar como seguidor).
    So a propria pessoa grava as suas (D15): a rota e `/me`.
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
