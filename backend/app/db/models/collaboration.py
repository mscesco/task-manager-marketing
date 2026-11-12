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
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import (
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    workspace_fk_column,
)


class TaskAssignment(UUIDPrimaryKeyMixin, Base):
    """Pivot task<->users. O banco suporta N responsaveis; o limite de 1 e da tela."""

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
        UniqueConstraint("task_id", "user_id", name="uq_assignment_task_user"),
        # COMMENT da tabela no banco; o dict de opcoes vai por ultimo.
        {
            "comment": (
                "PIVOT task<->users. O frontend inicialmente usa apenas 1 "
                "responsavel por task, mas a modelagem suporta MULTIPLOS "
                "responsaveis (N:N). Essa restricao NAO deve ser imposta no "
                "banco: e decisao de UI, nao de schema."
            )
        },
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Redundante com assigned_at e sem leitor; mapeada so para o autogenerate
    # nao propor `drop_column`.
    created_at: Mapped[datetime] = mapped_column(
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
        UniqueConstraint("task_id", "user_id", name="uq_watcher_task_user"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    # Sem leitor; mapeada so para o autogenerate nao propor `drop_column`.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Comment(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Comentario de uma task. Threading via parent_comment_id."""

    __tablename__ = "comment"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_comment_id_workspace"),
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

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CommentReaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Reacao a um comentario: uma por pessoa, reagir de novo troca o emoji.

    Sem soft delete proprio: segue a marca do comentario.
    `updated_at` ordena a fileira; o upsert do repository o seta (o
    `onupdate` do mixin so vale para UPDATE pelo ORM).
    """

    __tablename__ = "comment_reaction"
    __table_args__ = (
        ForeignKeyConstraint(
            ["comment_id", "workspace_id"],
            ["comment.id", "comment.workspace_id"],
            ondelete="CASCADE",
            name="comment_reaction_comment",
        ),
        ForeignKeyConstraint(
            ["user_id", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="CASCADE",
            name="comment_reaction_user",
        ),
        # "Uma por pessoa" fica no banco (dois cliques sao duas requisicoes);
        # o upsert do repository cita este nome.
        UniqueConstraint(
            "comment_id", "user_id", name="uq_comment_reaction_comment_user"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    comment_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    #: Forma fully-qualified (`normalize_emoji`); o maior emoji do catalogo tem 10 code points.
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)


class Attachment(UUIDPrimaryKeyMixin, Base):
    """Anexo (link ou arquivo) de um projeto ou de uma tarefa.

    CHECKs no banco: exatamente um dono; LINK exige `url`; FILE exige
    `storage_key`, `mime_type` e `file_size`. Sem soft delete proprio (segue o
    dono) e sem `updated_at`: a lista e substituida inteira.
    """

    __tablename__ = "attachment"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="CASCADE",
            name="attachment_task",
        ),
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["project.id", "project.workspace_id"],
            ondelete="CASCADE",
            name="attachment_project",
        ),
        ForeignKeyConstraint(
            ["uploaded_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="attachment_user",
        ),
        CheckConstraint("file_size >= 0", name="attachment_file_size_non_negative"),
        CheckConstraint(
            "(task_id IS NULL) <> (project_id IS NULL)", name="attachment_um_dono"
        ),
        CheckConstraint("kind IN ('LINK', 'FILE')", name="attachment_kind"),
    )

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: A ordem na lista do dono.
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
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

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    """Auditoria append-only: um trigger no banco bloqueia UPDATE/DELETE."""

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

    workspace_id: Mapped[uuid.UUID] = workspace_fk_column()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        comment=(
            "Contexto do evento para sistema futuro: source, trigger, "
            "automation, websocket, activity feed."
        ),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
