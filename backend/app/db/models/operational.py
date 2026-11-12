"""Models de project e task.

Subtarefa e task com parent_task_id; hierarquia em LTREE (`path`) + `depth`.
O banco so impede auto-referencia direta: ciclos indiretos sao validados no
servico.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.db.base import Base
from app.db.mixins import (
    ArchivableMixin,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)
from app.db.models.enums import PriorityLevel, ProjectStatus, TaskStatus


class Ltree(UserDefinedType):
    """Tipo LTREE, string no Python; os operadores ficam em SQL textual no repository."""

    cache_ok = True

    def get_col_spec(self, **kw: object) -> str:
        return "LTREE"


class Project(
    UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, ArchivableMixin, Base
):
    """Projeto: container de tasks. Projeto vivo sempre tem time."""

    __tablename__ = "project"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_project_id_workspace"),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="project_created_by",
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="project_team",
        ),
        # So o projeto apagado pode ficar sem time.
        CheckConstraint(
            "team_id IS NOT NULL OR deleted_at IS NOT NULL",
            name="project_team_required_when_common",
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, name="project_status", create_type=False),
        nullable=False,
        server_default=ProjectStatus.PLANNING.value,
        default=ProjectStatus.PLANNING,
    )
    priority: Mapped[PriorityLevel] = mapped_column(
        Enum(PriorityLevel, name="priority_level", create_type=False),
        nullable=False,
        server_default=PriorityLevel.MEDIUM.value,
        default=PriorityLevel.MEDIUM,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    # Nulo so em projeto apagado (ver CHECK).
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )

class Task(
    UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, ArchivableMixin, Base
):
    """Task -- agregado central. Subtasks sao tasks com parent_task_id."""

    __tablename__ = "task"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_task_id_workspace"),
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["project.id", "project.workspace_id"],
            ondelete="RESTRICT",
            name="task_project",
        ),
        ForeignKeyConstraint(
            ["parent_task_id", "workspace_id"],
            ["task.id", "task.workspace_id"],
            ondelete="RESTRICT",
            name="task_parent",
        ),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="task_team",
        ),
        ForeignKeyConstraint(
            ["created_by", "workspace_id"],
            ["users.id", "users.workspace_id"],
            ondelete="RESTRICT",
            name="task_created_by",
        ),
        CheckConstraint(
            "parent_task_id IS NULL OR parent_task_id <> id",
            name="task_no_self_parent",
        ),
        ForeignKeyConstraint(
            ["board_id", "workspace_id"],
            ["board.id", "board.workspace_id"],
            ondelete="RESTRICT",
            name="task_board",
        ),
        # Composta: a tarefa nao pode apontar para coluna de outro quadro.
        ForeignKeyConstraint(
            ["column_id", "board_id"],
            ["board_column.id", "board_column.board_id"],
            ondelete="RESTRICT",
            name="task_board_column",
        ),
        CheckConstraint("depth >= 0", name="task_depth_non_negative"),
        CheckConstraint("position >= 0", name="task_position_non_negative"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Nulo = tarefa avulsa (sem projeto).
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    # Toda tarefa vive num quadro e numa coluna.
    board_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    column_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    # Relogio do arquivamento: gravado quando a tarefa entra em coluna
    # terminal, limpo quando sai. Tornar uma coluna terminal reinicia a
    # contagem, em vez de arquivar de uma vez tudo o que ja estava parado ali.
    terminal_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment=(
            "Spec 035: quando a tarefa ENTROU em coluna terminal. Relogio "
            "do arquivamento automatico -- editar a semantica de uma coluna "
            "passa a reiniciar a contagem em vez de arquivar tudo na "
            "madrugada seguinte."
        ),
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=False,
        server_default=TaskStatus.BACKLOG.value,
        default=TaskStatus.BACKLOG,
    )
    priority: Mapped[PriorityLevel] = mapped_column(
        Enum(PriorityLevel, name="priority_level", create_type=False),
        nullable=False,
        server_default=PriorityLevel.MEDIUM.value,
        default=PriorityLevel.MEDIUM,
    )
    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0",
        default=0,
        comment="Ordenacao temporaria. Futuro: fractional indexing.",
    )
    depth: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    # Setado pelo servico de task ao criar/mover.
    path: Mapped[str] = mapped_column(
        Ltree(),
        nullable=False,
        comment="Hierarquia LTREE. Exemplo: root.child.subchild",
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Hora opcional do prazo; `None` = vence no dia (um timestamp unico nao
    # distinguiria "dia 19" de "dia 19 a meia-noite"). Relogio de parede, sem
    # fuso: a comparacao usa America/Sao_Paulo, como o `DeadlineNotifyService`.
    due_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Dedup do aviso de prazo: o due_date para o qual o aviso ja saiu. Mudou o
    # prazo, reabilita sozinho. So o job escreve aqui.
    due_soon_notified_for: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        comment=(
            "Spec 023: due_date pra qual o aviso de \"2 dias\" ja saiu "
            "(dedup). Difere do due_date atual => reabilita."
        ),
    )
    overdue_notified_for: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        comment=(
            "Spec 023: due_date pra qual o aviso de atraso ja saiu "
            "(dedup). Difere do due_date atual => reabilita."
        ),
    )
    created_by: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
