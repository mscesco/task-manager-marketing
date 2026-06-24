"""Router de colaboracao: responsaveis e observadores de uma task -- Entrega 4.

Rotas (sob /tasks/{task_id}):
    GET    /assignees                 -- lista IDs (exige ver a task)
    POST   /assignees                 -- designa (task.assign)
    DELETE /assignees/{user_id}       -- desatribui (task.assign)
    GET    /watchers                  -- lista IDs (exige ver a task)
    POST   /watchers                  -- observa (self: sem perm; 3o: task.assign)
    DELETE /watchers/{user_id}        -- deixa de observar

NOTA (ADR 0011): o POST/DELETE de watcher NAO usa require_permission no
router -- a distincao self vs terceiro (e a permissao do terceiro) e
resolvida no service. Proteger a rota aqui quebraria o self-watch de quem
nao tem task.assign. Por isso essas rotas dependem de TenantContextDep
(autenticacao) explicitamente.

Regra de negocio mora no CollaborationService. Commit no UoW.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.tasks.api.schemas import (
    AssigneeCreateRequest,
    CollaboratorListResponse,
    WatcherCreateRequest,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)

router = APIRouter(prefix="/tasks/{task_id}", tags=["collaboration"])


# --------------------------------------------------------
# Assignees
# --------------------------------------------------------
@router.get("/assignees", response_model=CollaboratorListResponse)
async def list_assignees(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> CollaboratorListResponse:
    """Lista responsaveis. Exige enxergar a task (404 senao)."""
    ids = await CollaborationService(session).list_assignees(task_id=task_id)
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)


@router.post(
    "/assignees",
    response_model=CollaboratorListResponse,
    dependencies=[Depends(require_permission("task.assign"))],
)
async def add_assignee(
    task_id: uuid.UUID,
    payload: AssigneeCreateRequest,
    uow: UoWDep,
    response: Response,
) -> CollaboratorListResponse:
    """Designa responsavel. 201 (novo) / 200 (no-op idempotente)."""
    service = CollaborationService(uow.session)
    _, created = await service.add_assignee(
        task_id=task_id, user_id=payload.user_id
    )
    await uow.commit()
    ids = await service.list_assignees(task_id=task_id)
    response.status_code = (
        status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)


@router.delete(
    "/assignees/{user_id}",
    response_model=CollaboratorListResponse,
    dependencies=[Depends(require_permission("task.assign"))],
)
async def remove_assignee(
    task_id: uuid.UUID, user_id: uuid.UUID, uow: UoWDep
) -> CollaboratorListResponse:
    """Desatribui. Par inexistente -> 404. 200 com a lista atual."""
    service = CollaborationService(uow.session)
    await service.remove_assignee(task_id=task_id, user_id=user_id)
    await uow.commit()
    ids = await service.list_assignees(task_id=task_id)
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)


# --------------------------------------------------------
# Watchers (sem require_permission -- service decide self vs terceiro)
# --------------------------------------------------------
@router.get("/watchers", response_model=CollaboratorListResponse)
async def list_watchers(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> CollaboratorListResponse:
    ids = await CollaborationService(session).list_watchers(task_id=task_id)
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)


@router.post("/watchers", response_model=CollaboratorListResponse)
async def add_watcher(
    task_id: uuid.UUID,
    payload: WatcherCreateRequest,
    _: TenantContextDep,
    uow: UoWDep,
    response: Response,
) -> CollaboratorListResponse:
    """Observa. user_id ausente/==eu => self (exige so ver). Terceiro =>
    task.assign + edicao (checado no service)."""
    service = CollaborationService(uow.session)
    _task, created = await service.add_watcher(
        task_id=task_id, user_id=payload.user_id
    )
    await uow.commit()
    ids = await service.list_watchers(task_id=task_id)
    response.status_code = (
        status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)


@router.delete("/watchers/{user_id}", response_model=CollaboratorListResponse)
async def remove_watcher(
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    _: TenantContextDep,
    uow: UoWDep,
) -> CollaboratorListResponse:
    service = CollaborationService(uow.session)
    await service.remove_watcher(task_id=task_id, user_id=user_id)
    await uow.commit()
    ids = await service.list_watchers(task_id=task_id)
    return CollaboratorListResponse(task_id=task_id, user_ids=ids)
