"""Router /projects. Leitura para qualquer autenticado; escrita por
project.create / project.update / project.delete. Regra de negocio no ProjectService.

A coluna `project.is_archived` existe no banco mas nao tem mais escritor.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import SessionDep, UoWDep
from app.db.models.enums import PriorityLevel, ProjectStatus
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.tasks.api.schemas import (
    ProjectCreateRequest,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdateRequest,
)
from app.modules.tasks.application.project_service import (
    CreateProjectCommand,
    ProjectFilters,
    ProjectService,
    UpdateProjectCommand,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/projects", tags=["projects"])


# --------------------------------------------------------
# Leitura
# --------------------------------------------------------
@router.get("", response_model=ProjectListResponse)
async def list_projects(
    _: TenantContextDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    project_status: ProjectStatus | None = Query(None, alias="status"),
    priority: PriorityLevel | None = None,
    include_archived: bool = False,
    team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta pelos projetos deste time e dos descendentes dele. "
            "Ausente = todos os que a lente permite."
        ),
    ),
) -> ProjectListResponse:
    """Lista projetos do workspace dentro da lente de time, paginado.

    `team_id` e opcional de proposito: o selo de projeto precisa de todos que a pessoa alcanca.
    """
    page_result = await ProjectService(session).list_page(
        params=PageParams(page=page, size=size),
        filters=ProjectFilters(
            status=project_status,
            priority=priority,
            include_archived=include_archived,
            team_id=team_id,
        ),
    )
    return ProjectListResponse(
        items=[ProjectResponse.model_validate(p) for p in page_result.items],
        total=page_result.total,
        page=page_result.page,
        size=page_result.size,
    )


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
) -> ProjectResponse:
    """Obtem um projeto pelo id.

    Pessoal alheio devolve 404 (privacy-preserving), nao 403.
    """
    project = await ProjectService(session).get(project_id)
    return ProjectResponse.model_validate(project)


# --------------------------------------------------------
# Escrita
# --------------------------------------------------------
@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("project.create"))],
)
async def create_project(
    payload: ProjectCreateRequest, uow: UoWDep
) -> ProjectResponse:
    """Cria um projeto COMUM no workspace corrente.

    Pessoais NAO sao criados por esta rota -- so via fluxos internos
    (provisioning, cadastro de membro).
    """
    project = await ProjectService(uow.session).create(
        CreateProjectCommand(
            title=payload.title,
            team_id=payload.team_id,
            description=payload.description,
            status=payload.status,
            priority=payload.priority,
            start_date=payload.start_date,
            due_date=payload.due_date,
        )
    )
    await uow.commit()
    return ProjectResponse.model_validate(project)


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    dependencies=[Depends(require_permission("project.update"))],
)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdateRequest,
    uow: UoWDep,
) -> ProjectResponse:
    """Atualiza campos editaveis. Semantica PATCH.

    `created_by` e imutavel por design (nao entra no payload).
    """
    project = await ProjectService(uow.session).update(
        project_id=project_id,
        command=UpdateProjectCommand(
            title=payload.title,
            description=payload.description,
            status=payload.status,
            priority=payload.priority,
            start_date=payload.start_date,
            due_date=payload.due_date,
        ),
    )
    await uow.commit()
    return ProjectResponse.model_validate(project)


@router.delete(
    "/{project_id}",
    response_model=ProjectResponse,
    dependencies=[Depends(require_permission("project.delete"))],
)
async def delete_project(
    project_id: uuid.UUID, uow: UoWDep
) -> ProjectResponse:
    """Soft-delete: marca deleted_at. 200 com body.

    Pessoal NAO pode ser deletado (409).
    """
    project = await ProjectService(uow.session).soft_delete(
        project_id=project_id
    )
    await uow.commit()
    return ProjectResponse.model_validate(project)
