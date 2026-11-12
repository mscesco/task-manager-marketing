"""Router de comentarios, reacoes e historico (sob /tasks/{task_id}).

Nenhuma rota usa require_permission: quem ve a tarefa, comenta; edicao e
moderacao sao resolvidas no CommentService.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    CommentCreateRequest,
    CommentListResponse,
    CommentReactionSetRequest,
    CommentResponse,
    CommentUpdateRequest,
    HistoryEventResponse,
    HistoryListResponse,
)
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.application.task_history_service import TaskHistoryService
from app.shared.pagination import PageParams

router = APIRouter(prefix="/tasks/{task_id}", tags=["comments"])


@router.get("/history", response_model=HistoryListResponse)
async def list_history(
    task_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
    page: int = 1,
    size: int = 20,
) -> HistoryListResponse:
    """Historico da tarefa, mais novo primeiro. 404 se nao ve a task.

    Fica aqui porque, como os comentarios, nao exige permissao (o `tasks_router` exige).
    """
    result = await TaskHistoryService(session).list_for_task(
        task_id=task_id, params=PageParams(page=page, size=size)
    )
    return HistoryListResponse(
        items=[HistoryEventResponse.model_validate(e) for e in result.items],
        total=result.total,
        page=result.page,
        size=result.size,
    )


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


@router.put("/comments/{comment_id}/reaction", response_model=CommentResponse)
async def set_comment_reaction(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    payload: CommentReactionSetRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> CommentResponse:
    """Poe ou troca a reacao de quem chama. Quem ve a task, reage.

    `PUT` porque e idempotente: "a minha reacao aqui passa a ser X". Devolve o
    comentario inteiro, para a tela trocar a fileira sem recarregar o thread.
    404 se nao ve a task ou o comentario nao esta ativo; 422 se nao e um emoji.
    """
    dto = await CommentService(uow.session).set_reaction(
        task_id=task_id, comment_id=comment_id, emoji=payload.emoji
    )
    await uow.commit()
    return CommentResponse.model_validate(dto)


@router.delete("/comments/{comment_id}/reaction", response_model=CommentResponse)
async def remove_comment_reaction(
    task_id: uuid.UUID, comment_id: uuid.UUID, _: TenantContextDep, uow: UoWDep
) -> CommentResponse:
    """Tira a reacao de quem chama. 200 com corpo (a tela precisa da fileira); idempotente."""
    dto = await CommentService(uow.session).remove_reaction(
        task_id=task_id, comment_id=comment_id
    )
    await uow.commit()
    return CommentResponse.model_validate(dto)
