"""Casos de uso de projetos.

Project e o container de tasks. Toda regra de negocio fica aqui --
o router so delega. Commit eh responsabilidade do Unit of Work,
acionado no router (ou no service-caller, no caso do provisioning).

Casos de uso (publicos):
    ProjectService.create                    -- cria projeto comum
    ProjectService.get                       -- obtem projeto (com
                                                check de privacidade)
    ProjectService.list_page                 -- lista paginada
    ProjectService.update                    -- atualiza campos
    ProjectService.archive                   -- is_archived=True
    ProjectService.unarchive                 -- is_archived=False
    ProjectService.soft_delete               -- deleted_at=now()
    ProjectService.create_personal_for       -- cria pessoal (uso
                                                interno do provisioning
                                                e do MemberService)
    ProjectService.get_personal_for_current_user
                                             -- usado pelo /me/personal-project

Decisoes-chave (ver specs/001-projects/spec.md +
docs/adr/0001-projeto-pessoal-automatico.md):

  - soft-delete (deleted_at) e archive (is_archived) sao SEMANTICAS
    DISTINTAS: archive eh reversivel; delete eh remocao operacional.
  - status livre + auto-marcacao de completed_at.
  - start_date <= due_date quando ambos informados.
  - PATCH "campo ausente = nao mexer".
  - Projeto pessoal:
      * is_personal eh flag imutavel (nem entra no UpdateProjectCommand);
      * created_by do pessoal eh imutavel;
      * pessoal NAO pode ser PATCHed, deletado nem arquivado (409 em
        todos os tres casos);
      * pessoal alheio eh invisivel em list/get (404, nao 403).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Project
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.tasks.infrastructure.project_repository import ProjectRepository
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

# Constantes do projeto pessoal. Title FIXO -- nao renomeavel
# (ver ADR 0001 e decisao 22 da spec).
PERSONAL_PROJECT_TITLE = "Pessoal"


# --------------------------------------------------------
# Commands / DTOs internos do dominio
# --------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CreateProjectCommand:
    """Dados para criar um projeto COMUM.

    Pessoais NAO sao criados via este command -- veja
    `ProjectService.create_personal_for`.
    """

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

    `is_personal` e `created_by` ausentes por DESIGN -- nao sao
    editaveis em nenhuma circunstancia.
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
            is_personal=False,
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
        """Retorna um projeto pelo id, com check de privacidade.

        Erros:
            EntityNotFoundError -- projeto nao existe, esta em outro
              workspace, OU eh pessoal de outro user (404, nao 403,
              pra nao vazar existencia).
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        self._assert_visible_to_current_user(project)
        return project

    async def list_page(
        self,
        params: PageParams,
        filters: ProjectFilters,
    ) -> Page[Project]:
        """Listagem paginada, escopada ao tenant.

        Filtros aplicados:
            - status, priority (opcionais, igualdade exata);
            - include_archived (default False);
            - PRIVACIDADE: pessoal alheio sempre invisivel. O service
              injeta o predicado
                  (is_personal = false) OR (created_by = me)
              antes de delegar ao repo.

        Ordenacao fixa: created_at DESC.
        """
        tenant = require_tenant()

        extra_filters = []
        if filters.status is not None:
            extra_filters.append(Project.status == filters.status)
        if filters.priority is not None:
            extra_filters.append(Project.priority == filters.priority)
        if not filters.include_archived:
            extra_filters.append(Project.is_archived.is_(False))
        # Privacidade: esconde pessoal alheio.
        extra_filters.append(
            or_(
                Project.is_personal.is_(False),
                Project.created_by == tenant.user_id,
            )
        )

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

        Pessoal eh IMUTAVEL via PATCH (decisao 22 da spec): qualquer
        tentativa em projeto com is_personal=true devolve 409. O
        usuario interage com o pessoal exclusivamente via as tasks
        dentro dele -- nao com o container.

        Para projetos comuns:
            - title eh normalizado com strip() se vier;
            - start_date <= due_date sobre o estado RESULTANTE
              (apos o merge);
            - transicao para COMPLETED -> seta completed_at;
            - transicao saindo de COMPLETED -> limpa completed_at.

        Erros:
            EntityNotFoundError -- projeto nao existe / pessoal alheio.
            BusinessRuleError   -- PATCH em projeto pessoal.
            ValidationError     -- title invalido ou datas inconsistentes.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        self._assert_visible_to_current_user(project)
        self._assert_not_personal(project, operation="editado")

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
            EntityNotFoundError -- projeto nao existe / pessoal alheio.
            BusinessRuleError   -- tentativa de arquivar PROPRIO pessoal.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        self._assert_visible_to_current_user(project)
        self._assert_not_personal(project, operation="arquivado")

        if not project.is_archived:
            project.is_archived = True
            await self._session.flush()
            logger.info("project.archived", project_id=str(project.id))
        # Se ja arquivado: no-op (idempotente).

        return project

    async def unarchive(self, *, project_id: uuid.UUID) -> Project:
        """Marca is_archived=False. Idempotente.

        Erros:
            EntityNotFoundError -- projeto nao existe / pessoal alheio.

        Pessoal nunca esta arquivado (decisao 22), entao chamar
        unarchive nele eh sempre no-op. NAO levanta erro -- pra
        manter idempotencia coerente.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        self._assert_visible_to_current_user(project)

        if project.is_archived:
            project.is_archived = False
            await self._session.flush()
            logger.info("project.unarchived", project_id=str(project.id))
        # Se ja desarquivado (inclui pessoal): no-op.

        return project

    async def soft_delete(self, *, project_id: uuid.UUID) -> Project:
        """Soft-delete: seta deleted_at.

        Erros:
            EntityNotFoundError -- projeto nao existe / pessoal alheio.
            BusinessRuleError   -- tentativa de deletar PROPRIO pessoal.
        """
        project = await self._repo.get_by_id_or_raise(project_id)
        self._assert_visible_to_current_user(project)
        self._assert_not_personal(project, operation="deletado")

        project.deleted_at = func.now()  # type: ignore[assignment]
        await self._session.flush()

        logger.info("project.deleted", project_id=str(project.id))
        return project

    # ----------------------------------------------------
    # Pessoal -- uso interno e endpoint /me
    # ----------------------------------------------------
    async def create_personal_for(self, user_id: uuid.UUID) -> Project:
        """Cria o projeto pessoal de `user_id` no workspace corrente.

        Chamado por:
            - WorkspaceProvisioningService (pro admin, dentro de
              tenant_scope efemero);
            - MemberService.create_member (pro novo membro).

        Idempotente: se o user ja tem pessoal (indice unico parcial),
        retorna o existente em vez de estourar IntegrityError. Isso
        torna o backfill e o cadastro de membro re-roda-veis sem dor.
        """
        existing = await self._repo.get_personal_by_user(user_id)
        if existing is not None:
            logger.info(
                "project.personal_already_exists",
                project_id=str(existing.id),
                user_id=str(user_id),
            )
            return existing

        project = Project(
            title=PERSONAL_PROJECT_TITLE,
            description="",
            status=ProjectStatus.ACTIVE,
            priority=PriorityLevel.MEDIUM,
            created_by=user_id,
            is_personal=True,
        )
        self._repo.add(project)
        await self._session.flush()

        logger.info(
            "project.personal_created",
            project_id=str(project.id),
            user_id=str(user_id),
        )
        return project

    async def get_personal_for_current_user(self) -> Project:
        """Retorna o projeto pessoal do user logado.

        Usado pelo endpoint GET /me/personal-project.

        Erros:
            EntityNotFoundError -- pessoal nao existe (cenario que
              indica bug ou banco corrompido; logamos com severidade
              alta antes de levantar).
        """
        tenant = require_tenant()
        project = await self._repo.get_personal_by_user(tenant.user_id)
        if project is None:
            logger.error(
                "project.personal_missing",
                user_id=str(tenant.user_id),
                workspace_id=str(tenant.workspace_id),
            )
            raise EntityNotFoundError(
                "PersonalProject", identifier=tenant.user_id
            )
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

    @staticmethod
    def _assert_not_personal(project: Project, *, operation: str) -> None:
        """Bloqueia delete/archive/update em projeto pessoal.

        Args:
            project: o projeto a checar (ja carregado).
            operation: rotulo da operacao para a mensagem de erro
                (ex. "deletado", "arquivado", "editado").

        Erros:
            BusinessRuleError (-> HTTP 409) se project.is_personal.
        """
        if project.is_personal:
            raise BusinessRuleError(
                f"Projeto pessoal nao pode ser {operation}.",
                details={
                    "project_id": str(project.id),
                    "is_personal": True,
                },
            )

    @staticmethod
    def _assert_visible_to_current_user(project: Project) -> None:
        """Bloqueia leitura/escrita em pessoal alheio.

        Levanta EntityNotFoundError (-> HTTP 404) -- nao
        AuthorizationError -- pra nao vazar existencia do pessoal
        do outro user.
        """
        tenant = require_tenant()
        if project.is_personal and project.created_by != tenant.user_id:
            raise EntityNotFoundError("Project", identifier=project.id)
