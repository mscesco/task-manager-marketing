"""Models de quadro: board e board_column.

A coluna declara o que significa (`semantic`), e o `task.status` e derivado
dela: quem pergunta "esta concluido?" nao precisa saber que colunas existem.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import ColumnSemantic, TaskStatus


class Board(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Quadro de um time. Apagar e soft delete (leva as tarefas junto);
    `BoardColumn` nao tem soft delete: apagar coluna move as tarefas e a remove.

    `board_um_padrao_por_time` ignora `deleted_at`: um quadro padrao apagado
    impediria criar outro, por isso apagar quadro padrao e proibido.
    """

    __tablename__ = "board"
    __table_args__ = (
        # Sustenta a FK composta de `board_column` e de `task`.
        UniqueConstraint("id", "workspace_id", name="uq_board_id_workspace"),
        ForeignKeyConstraint(
            ["team_id", "workspace_id"],
            ["team.id", "team.workspace_id"],
            ondelete="RESTRICT",
            name="board_team",
        ),
        # Um quadro padrao por time.
        Index(
            "board_um_padrao_por_time",
            "team_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        # Nome unico por time (apagar confirma digitando o nome); diferencia
        # maiuscula, e quadro apagado nao ocupa o nome. `board_column` nao tem
        # equivalente: o lote grava em etapas e o indice recusaria o estado
        # intermediario (ver `_assert_nomes_do_lote`).
        Index(
            "board_nome_unico_por_time",
            "team_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )


class BoardColumn(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Coluna de um quadro. `semantic` e o que a cascata de conclusao, a
    varredura de arquivamento, a checklist e o aviso de prazo leem."""

    __tablename__ = "board_column"
    __table_args__ = (
        # Sustenta a FK composta de `task`: (column_id, board_id).
        UniqueConstraint(
            "id", "board_id", name="uq_board_column_id_board"
        ),
        ForeignKeyConstraint(
            ["board_id", "workspace_id"],
            ["board.id", "board.workspace_id"],
            ondelete="RESTRICT",
            name="board_column_board",
        ),
        CheckConstraint("position >= 0", name="board_column_position_non_negative"),
        # Uma coluna de destino por semantica: para onde vai a tarefa concluida
        # quando ha duas colunas `DONE` (sem depender da ordem visual).
        Index(
            "board_column_um_destino_por_semantica",
            "board_id",
            "semantic",
            unique=True,
            postgresql_where=text("is_default_target"),
        ),
        # Uma coluna por status no quadro; parcial porque coluna criada por
        # gente tem `legacy_status` NULL.
        Index(
            "board_column_um_status_por_quadro",
            "board_id",
            "legacy_status",
            unique=True,
            postgresql_where=text("legacy_status IS NOT NULL"),
        ),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("workspace.id", ondelete="RESTRICT"),
        nullable=False,
    )
    board_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Token de tema (`var(--status-backlog-dot)`), para inverter no tema escuro;
    # coluna criada a mao pode levar hex.
    color: Mapped[str] = mapped_column(String(60), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    semantic: Mapped[ColumnSemantic] = mapped_column(
        Enum(ColumnSemantic, name="column_semantic", create_type=False),
        nullable=False,
    )
    # Desligado, a coluna nao recebe aviso de prazo (ex.: "Aguardando cliente").
    notify_deadline: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
    is_default_target: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    # De qual `task.status` a coluna veio: enquanto o front desenha o quadro
    # por status, a coluna e derivada dele (1:1). O inverso (status pela
    # semantica) perderia status, porque varias colunas dividem a mesma
    # semantica. NULL em coluna criada por gente. Nunca casar coluna por nome.
    legacy_status: Mapped[TaskStatus | None] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=True,
        # Identico ao COMMENT da migration (o drift compara o texto).
        comment=(
            "ADR 0033: de qual task.status esta coluna veio. PONTE -- "
            "enquanto o front desenha o quadro por status, a coluna e "
            "derivada do status (1:1). NULL em coluna criada por gente. "
            "Some quando o front passar a ler colunas do banco."
        ),
    )

    @property
    def is_status_bridge(self) -> bool:
        """A coluna e ponte de algum status, sem dizer qual (para
        `BoardColumnResponse`, que a le via `from_attributes`).

        `True` nao quer dizer "nao pode ser apagada": a trava e
        `board.is_default and legacy_status is not None`.
        """
        return self.legacy_status is not None
