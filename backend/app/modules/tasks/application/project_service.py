"""Casos de uso de projetos.

Project e o container de tasks. O commit e do Unit of Work, acionado no router.
`project.is_archived` ainda e lido (filtro da listagem), mas nao tem mais
escritor no produto.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.dates import validate_dates
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

# --------------------------------------------------------
# Commands / DTOs internos do dominio
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateProjectCommand:
    """Dados para criar um projeto."""

    title: str
    team_id: uuid.UUID
    description: str = ""
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class UpdateProjectCommand:
    """Patch parcial. Campo None = "nao mexer"."""

    title: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class ProjectFilters:
    """Filtros de listagem."""

    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    #: Nenhuma rota grava mais `is_archived=True`; o filtro segue porque o front manda.
    include_archived: bool = False
    #: Recorte por time: casa o time e seus descendentes. ``None`` = so a lente.
    team_id: uuid.UUID | None = None


# --------------------------------------------------------
# Service
# --------------------------------------------------------
class ProjectService:
    """Casos de uso de projeto."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = ProjectRepository(session)
        self._session = session

    async def create(self, command: CreateProjectCommand) -> Project:
        """Cria um projeto no workspace corrente.

        Erros:
            ValidationError -- title vazio, start > due.
        """
        title = command.title.strip()
        if not title:
            raise ValidationError(
                "Titulo do projeto nao pode ser vazio.",
                details={"field": "title"},
            )
        self._validate_dates(command.start_date, command.due_date)

        tenant = require_tenant()
        # O time tem de existir no workspace.
        if command.team_id not in {n.team_id for n in tenant.team_tree}:
            raise ValidationError(
                "Time informado nao existe neste workspace.",
                details={"field": "team_id"},
            )
        # E estar na lente de quem cria (422 no campo).
        editavel = team_scope.editable_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
        if editavel is not None and command.team_id not in editavel:
            raise ValidationError(
                "Time informado esta fora do seu alcance.",
                details={"field": "team_id"},
            )
        # E a pessoa precisa do verbo naquele time (403).
        self._assert_verbo_no_time("project.create", command.team_id)
        project = Project(
            title=title,
            description=command.description,
            status=command.status,
            priority=command.priority,
            start_date=command.start_date,
            due_date=command.due_date,
            created_by=tenant.user_id,
            team_id=command.team_id,
        )
        if command.status == ProjectStatus.COMPLETED:
            project.completed_at = func.now()  # type: ignore[assignment]

        # workspace_id e injetado pelo BaseRepository.add.
        self._repo.add(project)
        await self._session.flush()

        logger.info(
            "project.created",
            project_id=str(project.id),
            title=project.title,
            status=project.status.value,
        )
        return project

    async def get(self, project_id: uuid.UUID) -> Project:
        """Retorna um projeto pelo id, DENTRO da lente de time.

        Erros:
            EntityNotFoundError -- projeto nao existe, esta em outro
              workspace, OU o time dele esta fora da lente de quem pergunta.
              404 e nao 403, para nao confirmar que o id existe.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )
        if visible is not None and project.team_id not in visible:
            # Mesma forma do 404 de id inexistente, para serem indistinguiveis.
            raise EntityNotFoundError(Project.__name__, identifier=project_id)
        return project

    async def list_page(
        self,
        params: PageParams,
        filters: ProjectFilters,
    ) -> Page[Project]:
        """Listagem paginada, escopada ao tenant, a lente e (opcionalmente) a um time.

        A lente responde "posso ver?" (``None`` para admin); `team_id` responde
        "qual time estou olhando?" e vale para todos. Ordenacao: created_at DESC.
        """
        tenant = require_tenant()
        extra_filters = []
        if filters.status is not None:
            extra_filters.append(Project.status == filters.status)
        if filters.priority is not None:
            extra_filters.append(Project.priority == filters.priority)
        if not filters.include_archived:
            extra_filters.append(Project.is_archived.is_(False))

        # `None` = admin; o `workspace_id` entra sempre, no `_base_select`.
        visible = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )
        if visible is not None:
            extra_filters.append(Project.team_id.in_(visible))

        if filters.team_id is not None:
            # Time e descendentes: projeto de subtime aparece no contexto da raiz.
            alvo = {filters.team_id} | team_scope.descendants(
                filters.team_id, tenant.team_tree
            )
            # Combinado com a lente por AND: time fora da lente da vazio.
            extra_filters.append(Project.team_id.in_(alvo))
        return await self._repo.list_page(
            params,
            filters=extra_filters,
            order_by=Project.created_at.desc(),
        )

    async def update(
        self,
        *,
        project_id: uuid.UUID,
        command: UpdateProjectCommand,
    ) -> Project:
        """Atualiza campos editaveis com semantica PATCH.

            - title e normalizado com strip() se vier;
            - start_date <= due_date sobre o estado RESULTANTE
              (apos o merge);
            - transicao para COMPLETED -> seta completed_at;
            - transicao saindo de COMPLETED -> limpa completed_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
            ValidationError     -- title invalido ou datas inconsistentes.
        """
        # Pelo `get`, que aplica a lente (404); o repositorio so ve o workspace.
        project = await self.get(project_id)
        self._assert_verbo_no_time("project.update", project.team_id)

        if command.title is not None:
            title = command.title.strip()
            if not title:
                raise ValidationError(
                    "Titulo do projeto nao pode ser vazio.",
                    details={"field": "title"},
                )
            project.title = title

        if command.description is not None:
            project.description = command.description

        if command.priority is not None:
            project.priority = command.priority

        if command.status is not None and command.status != project.status:
            if command.status == ProjectStatus.COMPLETED:
                project.completed_at = func.now()  # type: ignore[assignment]
            elif project.status == ProjectStatus.COMPLETED:
                project.completed_at = None
            project.status = command.status

        if command.start_date is not None:
            project.start_date = command.start_date
        if command.due_date is not None:
            project.due_date = command.due_date

        # Valida o estado resultante (apos o merge).
        self._validate_dates(project.start_date, project.due_date)

        await self._session.flush()

        logger.info(
            "project.updated",
            project_id=str(project.id),
        )
        return project

    async def soft_delete(self, *, project_id: uuid.UUID) -> Project:
        """Soft-delete: seta deleted_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
        """
        project = await self.get(project_id)  # a lente -- ver `update`
        self._assert_verbo_no_time("project.delete", project.team_id)

        project.deleted_at = func.now()  # type: ignore[assignment]
        # As tarefas ficam, sem projeto; senao sobravam nas listas e davam 404 ao abrir.
        soltas = list(
            (
                await self._session.execute(
                    update(Task)
                    .where(
                        Task.project_id == project.id,
                        Task.workspace_id == project.workspace_id,
                    )
                    .values(project_id=None)
                    .returning(Task.id)
                )
            )
            .scalars()
            .all()
        )
        await self._session.flush()
        if soltas:
            from app.modules.tasks.application.collaboration_service import (
                CollaborationService,
            )

            # Sem projeto, quem ve e o time da tarefa: seguidor sem alcance sai.
            await CollaborationService(
                self._session
            ).remove_watchers_without_reach(task_ids=soltas)

        logger.info(
            "project.deleted", project_id=str(project.id), tasks_released=len(soltas)
        )
        return project

    @staticmethod
    def _assert_verbo_no_time(verbo: str, team_id: uuid.UUID | None) -> None:
        """403 se quem chama nao tem `verbo` no time do projeto.

        Sempre depois da lente, para o 403 nao vazar existencia.
        """
        if not require_tenant().has_permission_in(verbo, team_id):
            raise AuthorizationError(
                "Você não tem essa permissão nos projetos deste time.",
                details={"permission": verbo},
            )

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    _validate_dates = staticmethod(validate_dates)
