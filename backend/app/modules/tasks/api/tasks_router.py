"""Router de Tasks. Submodulo do modulo tasks.

Padrao igual aos demais routers: DI, validacao, autorizacao,
status code. Regra de negocio mora no TaskService.

Rotas:
    GET    /tasks                   -- list (filtros + paginacao)
    POST   /tasks                   -- create (task.create)
    GET    /tasks/{id}              -- get
    PATCH  /tasks/{id}              -- update (task.update)
    POST   /tasks/{id}/move         -- move (task.update)
    POST   /tasks/{id}/archive      -- archive (task.update)
    POST   /tasks/{id}/unarchive    -- unarchive (task.update)
    DELETE /tasks/{id}              -- soft-delete CASCATEADO (task.delete)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import SessionDep, UoWDep
from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.tasks.api.schemas import (
    DeleteTaskResponse,
    TaskCreateRequest,
    TaskDetailResponse,
    TaskListItem,
    TaskListResponse,
    TaskMoveRequest,
    TaskResponse,
    TaskUpdateRequest,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    MoveTaskCommand,
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/tasks", tags=["tasks"])


# --------------------------------------------------------
# Leitura
# --------------------------------------------------------
@router.get("", response_model=TaskListResponse)
async def list_tasks(
    _: TenantContextDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    project_id: uuid.UUID | None = None,
    parent_task_id: uuid.UUID | None = None,
    root_only: bool = False,
    task_status: TaskStatus | None = Query(None, alias="status"),
    priority: PriorityLevel | None = None,
    team_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
) -> TaskListResponse:
    """Lista tasks do workspace, paginado, com filtros.

    PRIVACIDADE: tasks em pessoal alheio nao aparecem.
    """
    page_result = await TaskService(session).list_page(
        params=PageParams(page=page, size=size),
        filters=TaskFilters(
            project_id=project_id,
            parent_task_id=parent_task_id,
            root_only=root_only,
            status=task_status,
            priority=priority,
            team_id=team_id,
            created_by=created_by,
            include_archived=include_archived,
            archived_only=archived_only,
        ),
    )
    # Selo de responsaveis: assignees da pagina inteira em UMA query (lote),
    # nao 1 por card (Entrega 10 / ADR 0025).
    amap = await CollaborationService(session).assignee_ids_for_tasks(
        page_result.items
    )
    return TaskListResponse(
        items=[
            TaskListItem.model_validate(t).model_copy(
                update={"assignee_ids": amap.get(t.id, [])}
            )
            for t in page_result.items
        ],
        total=page_result.total,
        page=page_result.page,
        size=page_result.size,
    )


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> TaskDetailResponse:
    """Obtem task pelo id. Pessoal alheio -> 404.

    Detalhe inclui assignee_ids / watcher_ids (so IDs). A listagem
    (GET /tasks) NAO os inclui -- mantem a query enxuta (decisao 9).
    """
    task = await TaskService(session).get(task_id)
    collab = CollaborationService(session)
    data = TaskResponse.model_validate(task).model_dump()
    return TaskDetailResponse(
        **data,
        assignee_ids=await collab.assignee_ids_for(task),
        watcher_ids=await collab.watcher_ids_for(task),
    )


# --------------------------------------------------------
# Escrita
# --------------------------------------------------------
@router.post(
    "",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("task.create"))],
)
async def create_task(
    payload: TaskCreateRequest, uow: UoWDep
) -> TaskResponse:
    """Cria task. Exige task.create."""
    task = await TaskService(uow.session).create(
        CreateTaskCommand(
            project_id=payload.project_id,
            title=payload.title,
            description=payload.description,
            parent_task_id=payload.parent_task_id,
            team_id=payload.team_id,
            status=payload.status,
            priority=payload.priority,
            start_date=payload.start_date,
            due_date=payload.due_date,
            # Spec 021: responsaveis ja na criacao. Sem esta linha o campo
            # chega no payload e e descartado -- a task nasce sem responsavel,
            # sem erro (o CreateTaskCommand tem default []). Coberto por
            # test_task_create_assignees_http_db.py (fatia HTTP).
            assignee_ids=payload.assignee_ids,
        )
    )
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.patch(
    "/{task_id}",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def update_task(
    task_id: uuid.UUID, payload: TaskUpdateRequest, uow: UoWDep
) -> TaskResponse:
    """Patch parcial. project_id e parent_task_id NAO entram (usar move)."""
    task = await TaskService(uow.session).update(
        task_id=task_id,
        command=UpdateTaskCommand(
            title=payload.title,
            description=payload.description,
            status=payload.status,
            priority=payload.priority,
            team_id=payload.team_id,
            start_date=payload.start_date,
            due_date=payload.due_date,
        ),
    )
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/move",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def move_task(
    task_id: uuid.UUID, payload: TaskMoveRequest, uow: UoWDep
) -> TaskResponse:
    """Move pra novo pai e/ou projeto. No-op silencioso se nada muda."""
    task = await TaskService(uow.session).move(
        task_id=task_id,
        command=MoveTaskCommand(
            parent_task_id=payload.parent_task_id,
            project_id=payload.project_id,
        ),
    )
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/archive",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def archive_task(task_id: uuid.UUID, uow: UoWDep) -> TaskResponse:
    """Arquiva. Idempotente. Sem cascata."""
    task = await TaskService(uow.session).archive(task_id=task_id)
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/unarchive",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def unarchive_task(task_id: uuid.UUID, uow: UoWDep) -> TaskResponse:
    """Desarquiva. Idempotente."""
    task = await TaskService(uow.session).unarchive(task_id=task_id)
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.delete(
    "/{task_id}",
    response_model=DeleteTaskResponse,
    dependencies=[Depends(require_permission("task.delete"))],
)
async def delete_task(
    task_id: uuid.UUID, uow: UoWDep
) -> DeleteTaskResponse:
    """Soft-delete CASCATEADO (ADR 0005).

    Resposta inclui `cascade_count` (numero de filhas apagadas junto).
    """
    result = await TaskService(uow.session).soft_delete(task_id=task_id)
    await uow.commit()
    # Combina campos do TaskResponse com cascade_count.
    task_data = TaskResponse.model_validate(result.task).model_dump()
    return DeleteTaskResponse(**task_data, cascade_count=result.cascade_count)
