"""Registro central dos models ORM.

Importar este pacote garante que TODOS os models sejam
registrados no `Base.metadata`. Isso e essencial para o
Alembic enxergar o schema completo no autogenerate.

Sempre que um novo model for criado, adicione-o aqui.
"""

from __future__ import annotations

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
from app.db.models.solicitations import (
    Solicitation,
    SolicitationForm,
    SolicitationQuestion,
    SolicitationSection,
)

__all__ = [
    # Organizacao
    "Workspace",
    "Team",
    "User",
    "UserTeam",
    # Operacional
    "Project",
    "Task",
    # Quadro (Spec 035)
    "Board",
    "BoardColumn",
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
