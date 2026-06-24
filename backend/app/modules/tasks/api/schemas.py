"""Schemas (DTOs) de request/response do modulo tasks.

Contem schemas de Project (Entrega 1) e Task (Entrega 2).

NOTAS de design:
    - is_personal e created_by NAO aparecem em Create/Update --
      pessoal nao eh criado via /projects (so via fluxos internos)
      e ambos os campos sao imutaveis.
    - Validacao cruzada (start_date <= due_date) vive no service,
      sobre o estado RESULTANTE do PATCH.
    - Em Task, project_id e parent_task_id NAO entram em
      TaskUpdateRequest -- usar /tasks/{id}/move.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.db.models.enums import PriorityLevel, ProjectStatus, TaskStatus

# Limite defensivo para description -- generoso, mas evita uploads
# acidentais de Mb de texto.
_DESCRIPTION_MAX = 100_000


# =========================================================
# PROJECT (Entrega 1)
# =========================================================
class ProjectResponse(BaseModel):
    """Representacao de um projeto na API."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str
    status: ProjectStatus
    priority: PriorityLevel
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    is_archived: bool
    is_personal: bool
    team_id: uuid.UUID | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ProjectCreateRequest(BaseModel):
    """Criacao de projeto COMUM. workspace_id, created_by e is_personal
    sao internos -- nunca vem do cliente."""

    title: str = Field(min_length=1, max_length=255)
    team_id: uuid.UUID  # Entrega 3: time dono (obrigatorio em comum).
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


class ProjectUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    is_personal e created_by ausentes por design -- imutaveis.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


class ProjectListResponse(BaseModel):
    """Pagina de projetos."""

    items: list[ProjectResponse]
    total: int
    page: int
    size: int


# =========================================================
# TASK (Entrega 2)
# =========================================================
class TaskResponse(BaseModel):
    """Representacao de uma task na API."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    parent_task_id: uuid.UUID | None
    team_id: uuid.UUID | None
    title: str
    description: str
    status: TaskStatus
    priority: PriorityLevel
    position: int
    depth: int
    path: str
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    is_archived: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class DeleteTaskResponse(TaskResponse):
    """Resposta do DELETE -- inclui contagem de filhas apagadas (ADR 0005)."""

    cascade_count: int


class TaskCreateRequest(BaseModel):
    """Criacao de task. workspace_id, created_by, path e depth sao
    internos -- nunca vem do cliente."""

    title: str = Field(min_length=1, max_length=255)
    project_id: uuid.UUID | None = None  # Entrega 3: opcional -> avulsa.
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


class TaskUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    project_id e parent_task_id NAO entram aqui -- usar
    POST /tasks/{id}/move.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


class TaskMoveRequest(BaseModel):
    """Move pra novo pai e/ou projeto. Pelo menos um dos dois.

    No-op silencioso se nada muda no final.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


class TaskListResponse(BaseModel):
    """Pagina de tasks."""

    items: list[TaskResponse]
    total: int
    page: int
    size: int


# =========================================================
# COLLABORATION (Entrega 4)
# =========================================================
class AssigneeCreateRequest(BaseModel):
    """Designa um responsavel (assignee) para a task."""

    user_id: uuid.UUID


class WatcherCreateRequest(BaseModel):
    """Inscreve um observador (watcher).

    user_id ausente/None => o proprio usuario logado (self-watch).
    """

    user_id: uuid.UUID | None = None


class CollaboratorListResponse(BaseModel):
    """Lista de IDs (responsaveis OU observadores) de uma task."""

    task_id: uuid.UUID
    user_ids: list[uuid.UUID]


class TaskDetailResponse(TaskResponse):
    """GET /tasks/{id}: TaskResponse + colaboradores (apenas IDs).

    A listagem (GET /tasks) NAO inclui estes campos -- mantem a query
    enxuta e evita N+1 (decisao 9 da spec 004).
    """

    assignee_ids: list[uuid.UUID]
    watcher_ids: list[uuid.UUID]


# ------------------------------------------------------------
# /me/assignments (Entrega 6 -- ADR 0017/0018)
# ------------------------------------------------------------
class MeRelation(str, Enum):
    """Relacao do usuario logado com uma task."""

    assignee = "assignee"
    creator = "creator"
    watcher = "watcher"


class MyTaskItem(TaskResponse):
    """Item de /me/assignments: task + relacoes que tenho + flag de escopo.

    `relations`: TODAS as relacoes que tenho com a task (independe do
    filtro). `out_of_scope`: estou ligado mas nao enxergo pela lente atual
    (ADR 0017) -- calculado por requisicao, nao e coluna.
    """

    relations: list[str]
    out_of_scope: bool


class MyAssignmentsResponse(BaseModel):
    """Pagina de /me/assignments."""

    items: list[MyTaskItem]
    total: int
    page: int
    size: int
