"""Enums de dominio. Os valores tem de ser identicos aos tipos ENUM do Postgres."""

from __future__ import annotations

from enum import StrEnum


class UserTeamRole(StrEnum):
    """Papel num time. ADMIN nao e papel de time: mora em `OrgRole`."""

    MANAGER = "MANAGER"
    SUPERVISOR = "SUPERVISOR"
    OPERATOR = "OPERATOR"


class OrgRole(StrEnum):
    """Papel na organizacao, sem time.

    ADMIN  -- renomeia a organizacao, apaga time raiz, promove gestor.
    GESTOR -- cria time raiz, cadastra e desativa pessoas, distribui papeis.

    Nao tem ordem: para comparar posto, use um mapa explicito, nunca as strings.
    """

    ADMIN = "ADMIN"
    GESTOR = "GESTOR"


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
    # Aprovacao de fora do time (cliente, fornecedor, outro time), distinta de
    # IN_REVIEW. O Postgres nao remove valor de ENUM: nao ha downgrade.
    EXTERNAL_APPROVAL = "EXTERNAL_APPROVAL"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class ColumnSemantic(StrEnum):
    """O que uma coluna de quadro significa, independente do rotulo.

    Usada pela cascata de conclusao, arquivamento, checklist e aviso de prazo.
    DONE e CANCELLED sao terminais e nao intercambiaveis: a checklist conta
    concluidas e ignora canceladas.
    """

    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class PriorityLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"
