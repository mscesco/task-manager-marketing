"""Models ORM de QUADRO: board e board_column (Spec 035, ADR 0030).

Ate 05/08/2026 "coluna" nao existia como entidade -- a coluna ERA o
`task.status`, um ENUM nativo. Enquanto for assim nao ha quadro configuravel,
e trocar o ENUM por texto livre quebraria em silencio os quatro subsistemas
que dependem do SIGNIFICADO do status.

A saida e a coluna DECLARAR o que significa (`semantic`). O `task.status`
continua existindo e passa a ser derivado dela -- os onze pontos do backend
que perguntam "isto esta concluido?" seguem funcionando sem saber que colunas
existem.
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
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import ColumnSemantic


class Board(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Quadro. Pertence a um TIME.

    ⚠️ Nesta spec existe UM por workspace: o geral, do time raiz. O modelo ja
    comporta o quadro personalizado de subtime (ADR 0030, decisao B), que e
    spec seguinte -- por isso `team_id` e nao `workspace_id` sozinho.
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
        # ⚠️ UM quadro padrao por TIME, garantido por indice parcial -- mesma
        # tecnica do `team_unica_raiz_por_workspace`. Sem isto, "qual e o
        # quadro do time?" passa a ter duas respostas, e a resposta errada
        # nao aparece na tela: aparece na tarefa que foi parar no quadro
        # errado.
        Index(
            "board_um_padrao_por_time",
            "team_id",
            unique=True,
            postgresql_where=text("is_default"),
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
    """Coluna de um quadro. O que a pessoa ve e configura.

    ⚠️ `semantic` e o campo que faz esta spec valer a pena. Sem ele, coluna
    configuravel derruba a cascata de conclusao, a varredura de arquivamento,
    a proporcao da checklist e o aviso de prazo -- os quatro em SILENCIO.
    """

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
        # ⚠️ UMA coluna de destino por semantica, por quadro. E o que responde
        # "para onde vai a tarefa concluida?" quando existem duas colunas
        # `DONE`. A alternativa (a primeira pela ordem) foi rejeitada no ADR
        # 0030: amarraria o destino da cascata a ordem VISUAL, e arrastar uma
        # coluna passaria a mudar comportamento sem ninguem pedir.
        Index(
            "board_column_um_destino_por_semantica",
            "board_id",
            "semantic",
            unique=True,
            postgresql_where=text("is_default_target"),
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
    # ⚠️ TOKEN de tema, nao hex. A Spec 031 (C1a) tirou os hex justamente
    # porque nao invertiam no tema escuro. As colunas migradas levam
    # `var(--status-backlog-dot)`; coluna criada a mao pode levar hex.
    color: Mapped[str] = mapped_column(String(60), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    semantic: Mapped[ColumnSemantic] = mapped_column(
        Enum(ColumnSemantic, name="column_semantic", create_type=False),
        nullable=False,
    )
    # ⚠️ Substitui o `BLOCKED` cravado no `DeadlineNotifyService`. Aquele
    # status carregava comportamento escondido ("nao ha o que agir enquanto
    # travada"); virar flag por coluna resolve o caso geral -- um time cria
    # "Aguardando cliente" e desliga a cobranca sem precisar de codigo.
    notify_deadline: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
    is_default_target: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
