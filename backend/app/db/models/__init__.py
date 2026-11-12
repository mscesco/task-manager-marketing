"""Importa todos os models para o `Base.metadata` (o Alembic depende disso).
Model novo entra aqui."""

from __future__ import annotations

from app.db.models.bases import (
    BaseChange,
    BaseColumn,
    BaseRow,
    BaseTable,
    BaseView,
)
from app.db.models.boards import Board, BoardColumn
from app.db.models.collaboration import (
    Attachment,
    Comment,
    CommentReaction,
    TaskAssignment,
    TaskHistory,
    TaskWatcher,
    TimeEntry,
)
from app.db.models.enums import (
    ColumnSemantic,
    PriorityLevel,
    ProjectStatus,
    TaskStatus,
    UserTeamRole,
)
from app.db.models.notifications import Notification, NotificationMute
from app.db.models.operational import Project, Task
from app.db.models.organization import Team, User, UserTeam, Workspace
from app.db.models.rate_limit import RateLimitHit
from app.db.models.solicitations import (
    Solicitation,
    SolicitationForm,
    SolicitationQuestion,
    SolicitationSection,
)

__all__ = [  # noqa: RUF022 -- agrupado por assunto, de proposito
    # Organizacao
    "Workspace",
    "Team",
    "User",
    "UserTeam",
    # Operacional
    "Project",
    "Task",
    # Quadro
    "Board",
    "BoardColumn",
    # Base
    "BaseTable",
    "BaseColumn",
    "BaseRow",
    "BaseView",
    "BaseChange",
    # Colaboracao / tempo / auditoria
    "TaskAssignment",
    "TaskWatcher",
    "Comment",
    "CommentReaction",
    "Attachment",
    "TimeEntry",
    "TaskHistory",
    # Notificacoes
    "Notification",
    "NotificationMute",
    # Freios de tentativa
    "RateLimitHit",
    # Solicitacoes (formulario publico)
    "Solicitation",
    "SolicitationForm",
    "SolicitationQuestion",
    "SolicitationSection",
    # Enums
    "UserTeamRole",
    "ProjectStatus",
    "TaskStatus",
    "PriorityLevel",
    "ColumnSemantic",
]
