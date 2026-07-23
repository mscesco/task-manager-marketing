"""Enums de dominio, espelhando os tipos ENUM do schema v5.

Os valores (strings) DEVEM ser identicos aos definidos no
PostgreSQL (CREATE TYPE ... AS ENUM). O SQLAlchemy mapeia
estes enums Python para os tipos nativos do banco.

Schema v5::

    user_team_role : ADMIN, MANAGER, SUPERVISOR, OPERATOR
    project_status : PLANNING, ACTIVE, BLOCKED, COMPLETED, CANCELLED
    task_status    : BACKLOG, PLANNED, IN_PROGRESS, IN_REVIEW,
                     BLOCKED, COMPLETED, CANCELLED
    priority_level : LOW, MEDIUM, HIGH, URGENT
"""

from __future__ import annotations

from enum import StrEnum


class UserTeamRole(StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    SUPERVISOR = "SUPERVISOR"
    OPERATOR = "OPERATOR"


class ProjectStatus(StrEnum):
    PLANNING = "PLANNING"
    ACTIVE = "ACTIVE"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TaskStatus(StrEnum):
    BACKLOG = "BACKLOG"
    PLANNED = "PLANNED"
    IN_PROGRESS = "IN_PROGRESS"
    IN_REVIEW = "IN_REVIEW"
    # Spec 026: aprovacao de FORA do time (cliente/fornecedor/outra area),
    # distinta da revisao interna (IN_REVIEW). Estado EXCLUSIVo -- um card
    # so tem um status. Adicionado ao enum nativo via migration 0006
    # (ALTER TYPE ADD VALUE, sem downgrade -- Postgres nao remove valor).
    EXTERNAL_APPROVAL = "EXTERNAL_APPROVAL"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class PriorityLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"
