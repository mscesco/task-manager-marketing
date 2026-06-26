"""Registro central dos models ORM.

Importar este pacote garante que TODOS os models sejam
registrados no `Base.metadata`. Isso e essencial para o
Alembic enxergar o schema completo no autogenerate.

Sempre que um novo model for criado, adicione-o aqui.
"""

from __future__ import annotations

from app.db.models.collaboration import (
    Attachment,
    Comment,
    TaskAssignment,
    TaskHistory,
    TaskWatcher,
    TimeEntry,
)
from app.db.models.enums import (
    PriorityLevel,
    ProjectStatus,
    TaskStatus,
    UserTeamRole,
)
from app.db.models.notifications import Notification
from app.db.models.operational import Project, Task
from app.db.models.organization import Team, User, UserTeam, Workspace

__all__ = [
    # Organizacao
    "Workspace",
    "Team",
    "User",
    "UserTeam",
    # Operacional
    "Project",
    "Task",
    # Colaboracao / tempo / auditoria
    "TaskAssignment",
    "TaskWatcher",
    "Comment",
    "Attachment",
    "TimeEntry",
    "TaskHistory",
    # Notificacoes
    "Notification",
    # Enums
    "UserTeamRole",
    "ProjectStatus",
    "TaskStatus",
    "PriorityLevel",
]
