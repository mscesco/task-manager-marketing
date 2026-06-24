"""Casos de uso de tasks.

Toda regra de negocio fica aqui. Commit no UoW (router).

Casos de uso (publicos):
    TaskService.create
    TaskService.get
    TaskService.list_page
    TaskService.update
    TaskService.move
    TaskService.archive
    TaskService.unarchive
    TaskService.soft_delete   -- cascateado (ADR 0005)

Decisoes-chave (ver specs/002-tasks-nucleo/spec.md +
docs/adr/0002 / 0003 / 0004 / 0005):

  - LTREE label: "t" + uuid.hex (ADR 0002).
  - Move e soft-delete usam SQL textual com predicado de tenant
    manual (ADR 0003);
  - Soft-delete cascateia pra subtree (ADR 0005);
  - task_history hibrido (ADR 0004), escrito atomicamente no UoW.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.application.project_service import ProjectService
from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.tasks.domain.history import (
    HistoryEntry,
    build_archived_entry,
    build_created_entry,
    build_deleted_entry,
    build_field_update_entry,
    build_move_entry,
    build_status_change_entry,
    build_unarchived_entry,
)
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    BusinessRuleError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)


# --------------------------------------------------------
# Commands / DTOs
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateTaskCommand:
    title: str
    project_id: uuid.UUID | None = None  # Entrega 3: opcional -> avulsa.
    description: str = ""
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None  # default = subtime do criador.
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class UpdateTaskCommand:
    """Patch parcial. None = nao mexer.

    project_id e parent_task_id NAO entram aqui -- usar move.
    """

    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class MoveTaskCommand:
    """Move pra outro pai e/ou projeto.

    Pelo menos um deve vir. None = nao mexe naquele campo. No-op
    silencioso se nada muda no final.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class TaskFilters:
    """Filtros suportados em GET /tasks."""

    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    root_only: bool = False
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    include_archived: bool = False
    created_by: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class SoftDeleteResult:
    """Resultado de soft_delete (cascade)."""

    task: Task
    cascade_count: int


# --------------------------------------------------------
# Service
# --------------------------------------------------------
class TaskService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = TaskRepository(session)
        self._projects = ProjectRepository(session)
        self._guards = TaskScopeGuards(session)

    # ----------------------------------------------------
    # CRUD (publico)
    # ----------------------------------------------------
    async def create(self, command: CreateTaskCommand) -> Task:
        """Cria task. 1 linha em task_history (CREATED)."""
        title = command.title.strip()
        if not title:
            raise ValidationError(
                "Titulo da task nao pode ser vazio.",
                details={"field": "title"},
            )
        self._validate_dates(command.start_date, command.due_date)

        tenant = require_tenant()

        # Entrega 3: resolve o time da task. Default = subtime do criador
        # (regra 5-7 da spec); sem time resolvido -> 422.
        team_id = command.team_id or team_scope.default_team_id(
            tenant.memberships, tenant.team_tree
        )
        if team_id is None:
            raise ValidationError(
                "Task precisa de um time (voce nao esta em nenhum subtime; "
                "informe team_id).",
                details={"field": "team_id"},
            )

        # Projeto (opcional). Se informado: deve existir e ser visivel.
        project: Project | None = None
        if command.project_id is not None:
            project = await self._projects.get_by_id_or_raise(command.project_id)
            ProjectService._assert_visible_to_current_user(project)
            # Em projeto comum, o time da task fica na subarvore do time
            # do projeto (regra 8 da spec).
            if not project.is_personal and project.team_id is not None:
                allowed = {project.team_id} | team_scope.descendants(
                    project.team_id, tenant.team_tree
                )
                if team_id not in allowed:
                    raise ValidationError(
                        "Time da task fora da subarvore do time do projeto.",
                        details={"field": "team_id"},
                    )

        # Se tem pai: deve existir, no mesmo workspace, e no mesmo projeto.
        parent: Task | None = None
        if command.parent_task_id is not None:
            parent = await self._repo.get_by_id_or_raise(command.parent_task_id)
            if parent.project_id != command.project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )

        task_id = uuid.uuid4()
        label = self._label_for(task_id)
        path, depth = self._compute_path_and_depth(parent, label)

        task = Task(
            id=task_id,
            title=title,
            description=command.description,
            project_id=command.project_id,
            parent_task_id=command.parent_task_id,
            team_id=team_id,
            status=command.status,
            priority=command.priority,
            start_date=command.start_date,
            due_date=command.due_date,
            created_by=tenant.user_id,
            path=path,
            depth=depth,
        )
        # Se ja vem como COMPLETED, marca completed_at.
        if command.status == TaskStatus.COMPLETED:
            task.completed_at = datetime.now(UTC)  # type: ignore[assignment]

        self._repo.add(task)
        await self._session.flush()

        # History
        entry = build_created_entry(
            title=title,
            project_id=command.project_id,
            parent_task_id=command.parent_task_id,
        )
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        logger.info(
            "task.created",
            task_id=str(task.id),
            project_id=str(task.project_id),
            title=task.title,
        )
        return task

    async def get(self, task_id: uuid.UUID) -> Task:
        """Get com privacidade do pessoal (404 em pessoal alheio)."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        return task

    async def list_page(
        self, params: PageParams, filters: TaskFilters
    ) -> Page[Task]:
        """Listagem paginada com filtros + privacidade do pessoal."""
        return await self._repo.list_page_with_filters(
            params,
            project_id=filters.project_id,
            parent_task_id=filters.parent_task_id,
            root_only=filters.root_only,
            status=filters.status,
            priority=filters.priority,
            team_id=filters.team_id,
            created_by=filters.created_by,
            include_archived=filters.include_archived,
        )

    async def update(
        self, *, task_id: uuid.UUID, command: UpdateTaskCommand
    ) -> Task:
        """Patch parcial. 1 linha em history por campo alterado.
        Status vira STATUS_CHANGED. parent/project NAO mexem (usar move)."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        # Calcula entries ANTES de mutar (snapshot do estado antigo).
        entries = self._diff_for_update(task, command)

        # Aplica patch campo a campo. None = nao mexer.
        if command.title is not None:
            title = command.title.strip()
            if not title:
                raise ValidationError(
                    "Titulo da task nao pode ser vazio.",
                    details={"field": "title"},
                )
            task.title = title

        if command.description is not None:
            task.description = command.description

        if command.priority is not None:
            task.priority = command.priority

        if command.team_id is not None:
            task.team_id = command.team_id

        # Status com ajuste de completed_at.
        if command.status is not None and command.status != task.status:
            if command.status == TaskStatus.COMPLETED:
                task.completed_at = datetime.now(UTC) # type: ignore[assignment]
            elif task.status == TaskStatus.COMPLETED:
                task.completed_at = None
            task.status = command.status

        if command.start_date is not None:
            task.start_date = command.start_date
        if command.due_date is not None:
            task.due_date = command.due_date

        # Valida estado resultante.
        self._validate_dates(task.start_date, task.due_date)

        if entries:
            tenant = require_tenant()
            await self._repo.write_history(
                task=task, user_id=tenant.user_id, entries=entries
            )

        await self._session.flush()
        logger.info(
            "task.updated",
            task_id=str(task.id),
            changes=len(entries),
        )
        return task

    async def move(
        self, *, task_id: uuid.UUID, command: MoveTaskCommand
    ) -> Task:
        """Move pra novo pai e/ou projeto (ADR 0003).

        No-op silencioso se nada muda.
        """
        # Pelo menos um dos dois.
        if command.parent_task_id is None and command.project_id is None:
            # Nem pai nem projeto informados -- nao eh erro, eh no-op.
            task = await self._repo.get_by_id_or_raise(task_id)
            await self._assert_visible_via_project(task)
            return task

        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        # Estado resultante.
        new_project_id = command.project_id or task.project_id
        new_parent_task_id = (
            command.parent_task_id
            if command.parent_task_id is not None
            else task.parent_task_id
        )

        # Se nao mudou nada de fato, no-op.
        if (
            new_project_id == task.project_id
            and new_parent_task_id == task.parent_task_id
        ):
            return task

        # Move pra si mesmo.
        if new_parent_task_id == task.id:
            raise BusinessRuleError(
                "Task nao pode ser pai de si mesma.",
                details={"task_id": str(task.id)},
            )

        # Projeto novo deve existir e ser visivel (pessoal alheio -> 404).
        if new_project_id != task.project_id:
            new_project = await self._projects.get_by_id_or_raise(new_project_id)
            ProjectService._assert_visible_to_current_user(new_project)

        # Pai novo (se houver): existe, mesmo workspace, mesmo projeto final.
        new_parent: Task | None = None
        if new_parent_task_id is not None:
            new_parent = await self._repo.get_by_id_or_raise(new_parent_task_id)
            if new_parent.project_id != new_project_id:
                raise ValidationError(
                    "Task pai esta em projeto diferente do informado.",
                    details={"field": "parent_task_id"},
                )
            # Ciclo: novo pai eh descendente da task?
            if await self._repo.detect_cycle(
                task=task, new_parent_id=new_parent_task_id
            ):
                raise BusinessRuleError(
                    "Move criaria ciclo na hierarquia.",
                    details={
                        "task_id": str(task.id),
                        "new_parent_task_id": str(new_parent_task_id),
                    },
                )

        # Snapshot para o history.
        old_project_id = task.project_id
        old_parent_task_id = task.parent_task_id
        old_path = task.path
        old_depth = task.depth

        # Reparent: atualiza task e subtree via SQL textual.
        await self._repo.reparent_subtree(
            task=task,
            old_path=old_path,
            old_depth=old_depth,
            new_parent_path=new_parent.path if new_parent else None,
            new_parent_depth=new_parent.depth if new_parent else None,
            new_parent_task_id=new_parent_task_id,
            new_project_id=new_project_id,
        )

        # History
        tenant = require_tenant()
        entry = build_move_entry(
            old_project_id=old_project_id,
            new_project_id=new_project_id,
            old_parent_task_id=old_parent_task_id,
            new_parent_task_id=new_parent_task_id,
        )
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        logger.info(
            "task.moved",
            task_id=str(task.id),
            old_project_id=str(old_project_id),
            new_project_id=str(new_project_id),
        )
        return task

    async def archive(self, *, task_id: uuid.UUID) -> Task:
        """Idempotente. Sem cascata. 1 linha em history se mudou."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        if not task.is_archived:
            task.is_archived = True
            tenant = require_tenant()
            await self._repo.write_history(
                task=task,
                user_id=tenant.user_id,
                entries=[build_archived_entry()],
            )
            await self._session.flush()
            logger.info("task.archived", task_id=str(task.id))
        # Idempotente: ja arquivado -> no-op.

        return task

    async def unarchive(self, *, task_id: uuid.UUID) -> Task:
        """Idempotente. Sem cascata."""
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        if task.is_archived:
            task.is_archived = False
            tenant = require_tenant()
            await self._repo.write_history(
                task=task,
                user_id=tenant.user_id,
                entries=[build_unarchived_entry()],
            )
            await self._session.flush()
            logger.info("task.unarchived", task_id=str(task.id))

        return task

    async def soft_delete(self, *, task_id: uuid.UUID) -> SoftDeleteResult:
        """Soft-delete CASCATEADO (ADR 0005).

        Apaga a task e toda a subtree. 1 linha em history para a
        task raiz com event_metadata.cascade_count. Filhas apagadas
        em cascade NAO geram history individual.
        """
        task = await self._repo.get_by_id_or_raise(task_id)
        await self._assert_visible_via_project(task)
        await self._assert_editable(task)

        cascade_count = await self._repo.soft_delete_subtree(task=task)

        tenant = require_tenant()
        entry = build_deleted_entry(cascade_count=cascade_count)
        await self._repo.write_history(
            task=task, user_id=tenant.user_id, entries=[entry]
        )
        await self._session.flush()

        logger.info(
            "task.deleted",
            task_id=str(task.id),
            cascade_count=cascade_count,
        )
        return SoftDeleteResult(task=task, cascade_count=cascade_count)

    # ----------------------------------------------------
    # Helpers privados
    # ----------------------------------------------------
    async def _assert_visible_via_project(self, task: Task) -> None:
        """Bloqueia leitura/escrita em task que o usuario nao enxerga.

        Delega ao guard compartilhado (app.modules.tasks.application.
        task_guards), que cobre privacidade do pessoal, lente de time e a
        regra `created_by` (ADR 0013). Levanta EntityNotFoundError (404)
        -- nao 403 -- pra nao vazar existencia.
        """
        await self._guards.assert_visible(task)

    async def _assert_editable(self, task: Task) -> None:
        """403 se o usuario VE a task mas nao pode edita-la (Fase B).

        Chamar APOS _assert_visible_via_project. Editavel depende SO do
        time da task -- assignment/criador nao concedem edicao (ADR 0013).
        """
        await self._guards.assert_editable(task)

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    @staticmethod
    def _label_for(task_id: uuid.UUID) -> str:
        """Label LTREE da task (ADR 0002): 't' + uuid.hex."""
        return f"t{task_id.hex}"

    @staticmethod
    def _compute_path_and_depth(
        parent: Task | None, new_label: str
    ) -> tuple[str, int]:
        """Deriva path e depth a partir do pai (None = raiz)."""
        if parent is None:
            return (new_label, 0)
        return (f"{parent.path}.{new_label}", parent.depth + 1)

    @staticmethod
    def _validate_dates(
        start_date: date | None, due_date: date | None
    ) -> None:
        """start_date <= due_date quando ambos informados."""
        if start_date is not None and due_date is not None:
            if start_date > due_date:
                raise ValidationError(
                    "Data de inicio nao pode ser posterior a data limite.",
                    details={"field": "due_date"},
                )

    @staticmethod
    def _diff_for_update(
        task: Task, command: UpdateTaskCommand
    ) -> list[HistoryEntry]:
        """Calcula HistoryEntry list pra um update. Puro.

        Regras (ADR 0004):
            - 0 entries se nada mudou de fato;
            - 1 entry por campo alterado;
            - status vira STATUS_CHANGED, nao UPDATED.
        """
        entries: list[HistoryEntry] = []

        # Title (apos strip).
        if command.title is not None:
            new_title = command.title.strip()
            if new_title and new_title != task.title:
                entries.append(
                    build_field_update_entry(
                        field_name="title", old=task.title, new=new_title
                    )
                )

        # Description.
        if (
            command.description is not None
            and command.description != task.description
        ):
            entries.append(
                build_field_update_entry(
                    field_name="description",
                    old=task.description,
                    new=command.description,
                )
            )

        # Priority.
        if command.priority is not None and command.priority != task.priority:
            entries.append(
                build_field_update_entry(
                    field_name="priority",
                    old=task.priority,
                    new=command.priority,
                )
            )

        # Team_id.
        if command.team_id is not None and command.team_id != task.team_id:
            entries.append(
                build_field_update_entry(
                    field_name="team_id",
                    old=task.team_id,
                    new=command.team_id,
                )
            )

        # Status: evento dedicado.
        if command.status is not None and command.status != task.status:
            completed_changed = (
                command.status == TaskStatus.COMPLETED
                or task.status == TaskStatus.COMPLETED
            )
            entries.append(
                build_status_change_entry(
                    old_status=task.status,
                    new_status=command.status,
                    completed_at_changed=completed_changed,
                )
            )

        # Datas.
        if (
            command.start_date is not None
            and command.start_date != task.start_date
        ):
            entries.append(
                build_field_update_entry(
                    field_name="start_date",
                    old=task.start_date,
                    new=command.start_date,
                )
            )
        if command.due_date is not None and command.due_date != task.due_date:
            entries.append(
                build_field_update_entry(
                    field_name="due_date",
                    old=task.due_date,
                    new=command.due_date,
                )
            )

        return entries
