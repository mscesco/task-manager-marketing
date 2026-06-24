"""Router de comentarios -- Entrega 14.

Rotas (sob /tasks/{task_id}):
    GET    /comments               -- lista o thread (exige ver a task)
    POST   /comments               -- comenta (exige ver a task -- D1)
    PATCH  /comments/{comment_id}  -- edita (so o autor -- D2)
    DELETE /comments/{comment_id}  -- apaga (autor ou moderador task.delete -- D3)

NENHUMA rota usa require_permission (igual ao watcher da E4): "quem ve,
comenta", e a alcada de edicao/moderacao e resolvida no CommentService.
Proteger a rota com permissao quebraria o D1. Por isso dependem so de
TenantContextDep (autenticacao). Regra de negocio mora no service; commit no UoW.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    CommentCreateRequest,
    CommentListResponse,
    CommentResponse,
    CommentUpdateRequest,
)
from app.modules.tasks.application.comment_service import CommentService
from app.shared.pagination import PageParams

router = APIRouter(prefix="/tasks/{task_id}", tags=["comments"])


@router.get("/comments", response_model=CommentListResponse)
async def list_comments(
    task_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
    page: int = 1,
    size: int = 50,
) -> CommentListResponse:
    """Thread da task, do mais antigo ao mais novo. 404 se nao ve a task."""
    result = await CommentService(session).list_comments(
        task_id=task_id, params=PageParams(page=page, size=size)
    )
    return CommentListResponse(
        items=[CommentResponse.model_validate(c) for c in result.items],
        total=result.total,
        page=result.page,
        size=result.size,
    )


@router.post(
    "/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    task_id: uuid.UUID, payload: CommentCreateRequest, _: TenantContextDep, uow: UoWDep
) -> CommentResponse:
    """Comenta na task. Exige enxergar a task (404 senao). Replica opcional."""
    service = CommentService(uow.session)
    dto = await service.create_comment(
        task_id=task_id,
        content=payload.content,
        parent_comment_id=payload.parent_comment_id,
    )
    await uow.commit()
    return CommentResponse.model_validate(dto)


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
async def edit_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    payload: CommentUpdateRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> CommentResponse:
    """Edita o conteudo. So o autor (403 senao). 404 se ja apagado."""
    service = CommentService(uow.session)
    dto = await service.edit_comment(
        task_id=task_id, comment_id=comment_id, content=payload.content
    )
    await uow.commit()
    return CommentResponse.model_validate(dto)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    task_id: uuid.UUID, comment_id: uuid.UUID, _: TenantContextDep, uow: UoWDep
) -> Response:
    """Soft-delete. Autor ou moderador (task.delete). 404 se ausente."""
    await CommentService(uow.session).delete_comment(
        task_id=task_id, comment_id=comment_id
    )
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
