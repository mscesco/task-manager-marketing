"""Casos de uso de projetos.

Project e o container de tasks. Toda regra de negocio fica aqui --
o router so delega. Commit eh responsabilidade do Unit of Work,
acionado no router (ou no service-caller, no caso do provisioning).

Casos de uso (publicos):
    ProjectService.create                    -- cria projeto comum
    ProjectService.get                       -- obtem projeto
    ProjectService.list_page                 -- lista paginada
    ProjectService.update                    -- atualiza campos
    ProjectService.archive                   -- is_archived=True
    ProjectService.unarchive                 -- is_archived=False
    ProjectService.soft_delete               -- deleted_at=now()

Decisoes-chave (ver specs/001-projects/spec.md):

  - soft-delete (deleted_at) e archive (is_archived) sao SEMANTICAS
    DISTINTAS: archive eh reversivel; delete eh remocao operacional.
  - status livre + auto-marcacao de completed_at.
  - start_date <= due_date quando ambos informados.
  - PATCH "campo ausente = nao mexer".

⚠️⚠️ O PROJETO PESSOAL SAIU EM 10/09/2026, e com ele a ADR 0001 (marcada como
revertida la). Decisao dela: *"nao sei como implementar projeto pessoal, muito
confuso, minha intencao e tirar, pois foi pensado de outra forma"*.

⚠️ E O QUE SAIU JUNTO E O QUE VALE LEMBRAR: era a UNICA regra de privacidade do
produto -- tarefa em projeto pessoal era invisivel para todo mundo, inclusive
para o ADMIN, e o dono a editava mesmo fora dos times que ele alcanca. Hoje nao
ha nada privado neste sistema: tudo o que existe pertence a um time, e quem
alcanca o time ve. Se um dia voltar a fazer sentido esconder algo de todos,
isto e um recorte novo -- e nao a volta de uma flag.

⚠️ A remocao foi limpa por sorte de medicao: 29 pessoais no banco, TODOS com
zero tarefas, e sem tela nenhuma que os expusesse.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.shared.exceptions.base import ValidationError
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

# --------------------------------------------------------
# Commands / DTOs internos do dominio
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateProjectCommand:
    """Dados para criar um projeto."""

    title: str
    team_id: uuid.UUID  # Entrega 3: time dono (obrigatorio em comum).
    description: str = ""
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class UpdateProjectCommand:
    """Patch parcial. Campo None = "nao mexer".

    `created_by` ausente por DESIGN -- nao e editavel em nenhuma
    circunstancia.
    """

    title: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


@dataclass(frozen=True, slots=True)
class ProjectFilters:
    """Filtros de listagem suportados nesta entrega."""

    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    include_archived: bool = False


# --------------------------------------------------------
# Service
# --------------------------------------------------------
class ProjectService:
    """Casos de uso de projeto."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = ProjectRepository(session)
        self._session = session

    # ----------------------------------------------------
    # CRUD-de-casos-de-uso (publico)
    # ----------------------------------------------------
    async def create(self, command: CreateProjectCommand) -> Project:
        """Cria um projeto COMUM no workspace corrente.

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
        # Entrega 3: o time tem que existir no workspace (arvore do contexto).
        if command.team_id not in {n.team_id for n in tenant.team_tree}:
            raise ValidationError(
                "Time informado nao existe neste workspace.",
                details={"field": "team_id"},
            )
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
        # Se ja vem como COMPLETED, marca completed_at na criacao.
        if command.status == ProjectStatus.COMPLETED:
            project.completed_at = func.now()  # type: ignore[assignment]

        # workspace_id e injetado pelo BaseRepository.add a partir
        # do tenant corrente.
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
        """Retorna um projeto pelo id.

        Erros:
            EntityNotFoundError -- projeto nao existe ou esta em outro
              workspace.
        """
        return await self._repo.get_by_id_or_raise(project_id)

    async def list_page(
        self,
        params: PageParams,
        filters: ProjectFilters,
    ) -> Page[Project]:
        """Listagem paginada, escopada ao tenant.

        Filtros aplicados:
            - status, priority (opcionais, igualdade exata);
            - include_archived (default False).

        ⚠️ NAO HA MAIS PREDICADO DE PRIVACIDADE. Ate 10/09 este metodo injetava
        `(is_personal = false) OR (created_by = me)` para esconder o pessoal
        alheio. Sem projeto pessoal, todo projeto pertence a um time e a lente
        do time responde sozinha.

        Ordenacao fixa: created_at DESC.
        """
        extra_filters = []
        if filters.status is not None:
            extra_filters.append(Project.status == filters.status)
        if filters.priority is not None:
            extra_filters.append(Project.priority == filters.priority)
        if not filters.include_archived:
            extra_filters.append(Project.is_archived.is_(False))
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

            - title eh normalizado com strip() se vier;
            - start_date <= due_date sobre o estado RESULTANTE
              (apos o merge);
            - transicao para COMPLETED -> seta completed_at;
            - transicao saindo de COMPLETED -> limpa completed_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
            ValidationError     -- title invalido ou datas inconsistentes.
        """
        project = await self._repo.get_by_id_or_raise(project_id)

        # Aplica o patch campo a campo. None = nao mexer.
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

        # Transicao de status com ajuste de completed_at.
        if command.status is not None and command.status != project.status:
            if command.status == ProjectStatus.COMPLETED:
                project.completed_at = func.now()  # type: ignore[assignment]
            elif project.status == ProjectStatus.COMPLETED:
                # Saindo de COMPLETED para qualquer outro: limpa.
                project.completed_at = None
            project.status = command.status

        if command.start_date is not None:
            project.start_date = command.start_date
        if command.due_date is not None:
            project.due_date = command.due_date

        # Valida o ESTADO RESULTANTE (apos o merge).
        self._validate_dates(project.start_date, project.due_date)

        await self._session.flush()

        logger.info(
            "project.updated",
            project_id=str(project.id),
        )
        return project

    async def archive(self, *, project_id: uuid.UUID) -> Project:
        """Marca is_archived=True. Idempotente.

        Erros:
            EntityNotFoundError -- projeto nao existe.
        """
        project = await self._repo.get_by_id_or_raise(project_id)

        if not project.is_archived:
            project.is_archived = True
            await self._session.flush()
            logger.info("project.archived", project_id=str(project.id))
        # Se ja arquivado: no-op (idempotente).

        return project

    async def unarchive(self, *, project_id: uuid.UUID) -> Project:
        """Marca is_archived=False. Idempotente.

        Erros:
            EntityNotFoundError -- projeto nao existe.
        """
        project = await self._repo.get_by_id_or_raise(project_id)

        if project.is_archived:
            project.is_archived = False
            await self._session.flush()
            logger.info("project.unarchived", project_id=str(project.id))
        # Se ja desarquivado: no-op.

        return project

    async def soft_delete(self, *, project_id: uuid.UUID) -> Project:
        """Soft-delete: seta deleted_at.

        Erros:
            EntityNotFoundError -- projeto nao existe.
        """
        project = await self._repo.get_by_id_or_raise(project_id)

        project.deleted_at = func.now()  # type: ignore[assignment]
        await self._session.flush()

        logger.info("project.deleted", project_id=str(project.id))
        return project

    # ----------------------------------------------------
    # Helpers puros (testaveis sem DB)
    # ----------------------------------------------------
    @staticmethod
    def _validate_dates(
        start_date: date | None, due_date: date | None
    ) -> None:
        """Garante start_date <= due_date quando ambos informados."""
        if start_date is not None and due_date is not None:
            if start_date > due_date:
                raise ValidationError(
                    "Data de inicio nao pode ser posterior a data limite.",
                    details={"field": "due_date"},
                )
