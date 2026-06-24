"""Models ORM de colaboracao, tempo e auditoria.

task_assignment : pivot task<->users (multiplos responsaveis).
task_watcher    : observadores de uma task.
comment         : comentarios (com threading via parent).
attachment      : anexos de arquivos.
time_entry      : registros de tempo / timers.
task_history    : auditoria append-only (imutavel no banco).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


def _ws_fk() -> Mapped[uuid.UUID]:
    """Coluna workspace_id padrao (FK simples para workspace)."""
    return mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )


class TaskAssignment(UUIDPrimaryKeyMixin, Base):
    """Pivot task<->users. O banco suporta N responsaveis;
    o frontend inicialmente usa apenas 1 (decisao de UI)."""

    __tablename__ = "task_assignment"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="CASCADE",
            name="task_assignment_task",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="task_assignment_user",
        ),
        ForeignKeyConstraint(
            ["assigned_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="task_assignment_assigned_by",
        ),
        UniqueConstraint("task_id", "user_id", name="task_assignment_task_user"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskWatcher(UUIDPrimaryKeyMixin, Base):
    """Observadores de uma task."""

    __tablename__ = "task_watcher"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="CASCADE",
            name="task_watcher_task",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="task_watcher_user",
        ),
        UniqueConstraint("task_id", "user_id", name="task_watcher_task_user"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)


class Comment(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Comentario de uma task. Threading via parent_comment_id."""

    __tablename__ = "comment"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="comment_id_workspace"),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="comment_task",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="comment_user",
        ),
        ForeignKeyConstraint(
            ["parent_comment_id", "workspace_id"],
            ["comment.id", "comment.workspace_id"],
            ondelete="RESTRICT",
            name="comment_parent",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    content: Mapped[str] = mapped_column(String, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Attachment(UUIDPrimaryKeyMixin, Base):
    """Anexo de arquivo de uma task. created_at via TimestampMixin? Nao:
    o schema so tem created_at aqui -- declarado explicitamente."""

    __tablename__ = "attachment"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="attachment_task",
        ),
        ForeignKeyConstraint(
            ["uploaded_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="attachment_user",
        ),
        CheckConstraint("file_size >= 0", name="attachment_file_size_non_negative"),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TimeEntry(UUIDPrimaryKeyMixin, Base):
    """Registro de tempo. Apenas 1 timer ativo por usuario
    (UNIQUE INDEX WHERE ended_at IS NULL no schema)."""

    __tablename__ = "time_entry"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="time_entry_task",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="time_entry_user",
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at",
            name="time_entry_interval",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="time_entry_duration_non_negative",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_manual: Mapped[bool] = mapped_column(
        nullable=False, server_default="false", default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskHistory(UUIDPrimaryKeyMixin, Base):
    """Auditoria append-only. IMUTAVEL: o banco bloqueia
    UPDATE/DELETE via trigger. O backend NUNCA deve tentar
    atualizar ou remover linhas desta tabela -- apenas INSERT."""

    __tablename__ = "task_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="task_history_task",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="task_history_user",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column(
        "metadata", JSONB, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
