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
    Text,
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
        UniqueConstraint("task_id", "user_id", name="uq_assignment_task_user"),
        # COMMENT da TABELA no schema v5 -- declarado pra o autogenerate
        # nao propor drop_table_comment. Dict de opcoes vai por ULTIMO.
        {
            "comment": (
                "PIVOT task<->users. O frontend inicialmente usa apenas 1 "
                "responsavel por task, mas a modelagem suporta MULTIPLOS "
                "responsaveis (N:N). Essa restricao NAO deve ser imposta no "
                "banco: e decisao de UI, nao de schema."
            )
        },
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # ⚠️ Coluna do baseline 0001, redundante com assigned_at (as duas
    # nascem now()). Mapeada aqui SO pra o autogenerate parar de propor
    # `drop_column`. Nada le este valor; remover de verdade e migration
    # propria, com quem confirme que nenhum relatorio depende dela.
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

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    # ⚠️ Mesma historia do created_at de task_assignment: existe no banco
    # desde 0001, ninguem le, mapeada pra evitar o drop_column.
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

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
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
    """Reacao de uma pessoa a um comentario (Spec 050).

    Uma por pessoa por comentario -- reagir de novo TROCA o emoji. Quem ve a
    task, reage (sem permissao, como comentar).

    ⚠️ SEM soft-delete PROPRIO, de proposito (spec §4.6): as reacoes seguem a
    marca do COMENTARIO. Comentario apagado nao mostra reacao, e voltam se
    ele voltar (`restaurar_quadro.sql`). Uma segunda marca aqui teria de ser
    lembrada no servico, no SQL cru da cascata de tarefa e no script.

    ⚠️ `updated_at` ORDENA a fileira (§4.4): trocar conta como reacao nova no
    emoji de destino. O upsert do repository o seta explicitamente -- o
    `onupdate` do mixin so vale para UPDATE pelo ORM.
    """

    __tablename__ = "comment_reaction"
    __table_args__ = (
        # CASCADE: se um dia um comentario for apagado DE VERDADE, as reacoes
        # nao seguram a linha.
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
        # ⚠️ "Uma por pessoa" MORA AQUI, e nao no servico (§4.2): dois cliques
        # rapidos sao duas requisicoes. O upsert do repository cita este nome.
        UniqueConstraint(
            "comment_id", "user_id", name="uq_comment_reaction_comment_user"
        ),
    )

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    comment_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    #: A forma fully-qualified (`normalize_emoji`). 16 cabe folgado: o maior
    #: emoji da biblioteca tem 10 code points (medido em 15/09).
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)


#: Os dois tipos de anexo. Hoje so LINK e gravado (Spec 052); FILE guarda o
#: lugar do upload, que nao existe ainda.
ATTACHMENT_KINDS = ("LINK", "FILE")


class Attachment(UUIDPrimaryKeyMixin, Base):
    """Anexo de um PROJETO ou de uma TAREFA -- link ou arquivo. Spec 052, fatia B.

    ⚠️⚠️ ERA "anexo de arquivo de task", do schema v5, e nunca foi usado (0
    linhas em producao em 16/09). A `0026` o reformou em vez de criar tabelas
    novas, por decisao da Camila. Ver o cabecalho da migration.

    Regras que moram no BANCO (CHECKs da `0026`):
      - exatamente um dono: `task_id` OU `project_id`;
      - `kind` LINK exige `url` e nao tem `storage_key`;
      - `kind` FILE exige `storage_key`, `mime_type` e `file_size`, sem `url`.

    ⚠️ SEM soft-delete PROPRIO: o anexo segue a marca do dono, como as reacoes
    seguem a do comentario. Tarefa ou projeto apagados somem das telas e levam
    os anexos junto.

    `created_at` explicito, sem `TimestampMixin`: o schema nunca teve
    `updated_at` aqui, e a lista e substituida inteira (nao ha edicao de linha).
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

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    #: O nome que aparece (era `file_name`).
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

    workspace_id: Mapped[uuid.UUID] = _ws_fk()
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
