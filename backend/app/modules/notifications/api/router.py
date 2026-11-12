"""Router de notificacoes in-app (/notifications): feed, contagem, marcar como lida.

Notificacao e pessoal: sem require_permission; a trava e recipient == usuario
logado, aplicada no service/repository. Rotas estaticas vem antes da dinamica.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.notifications.api.schemas import (
    AlvoResponse,
    AlvosResponse,
    MarkAllReadResponse,
    NotificationListResponse,
    NotificationResponse,
    UnreadCountResponse,
)
from app.modules.notifications.application.notification_service import (
    NotificationService,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    _: TenantContextDep,
    session: SessionDep,
    unread_only: bool = False,
    page: int = 1,
    size: int = 20,
    # `type` repete: ?type=A&type=B.
    type: list[str] = Query(default_factory=list),
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    # A aba "Silenciadas"; sem ele, as silenciadas ficam escondidas.
    muted: bool = False,
) -> NotificationListResponse:
    """Feed do usuario logado, ultima mudanca primeiro."""
    result = await NotificationService(session).list_for_me(
        PageParams(page=page, size=size),
        unread_only=unread_only,
        tipos=tuple(type),
        task_id=task_id,
        project_id=project_id,
        muted=muted,
    )
    return NotificationListResponse(
        items=[NotificationResponse.model_validate(d) for d in result.items],
        total=result.total,
        page=result.page,
        size=result.size,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    _: TenantContextDep, session: SessionDep, muted: bool = False
) -> UnreadCountResponse:
    """Contagem de nao-lidas do sino (sem as silenciadas; `muted=true` conta so elas)."""
    count = await NotificationService(session).count_unread(muted=muted)
    return UnreadCountResponse(count=count)


@router.get("/targets", response_model=AlvosResponse)
async def list_targets(
    _: TenantContextDep, session: SessionDep, q: str = ""
) -> AlvosResponse:
    """Sugestoes do filtro "Tarefa ou projeto"."""
    alvos = await NotificationService(session).alvos(q)
    return AlvosResponse(items=[AlvoResponse.model_validate(a) for a in alvos])


@router.post("/read-all", response_model=MarkAllReadResponse)
async def mark_all_read(
    _: TenantContextDep,
    uow: UoWDep,
    # Os mesmos filtros do GET; sem nenhum, marca todas.
    type: list[str] = Query(default_factory=list),
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    muted: bool = False,
) -> MarkAllReadResponse:
    """Marca as nao-lidas do usuario como lidas -- todas, ou as do filtro."""
    updated = await NotificationService(uow.session).mark_all_read(
        tipos=tuple(type),
        task_id=task_id,
        project_id=project_id,
        muted=muted,
    )
    await uow.commit()
    return MarkAllReadResponse(updated=updated)


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def mark_read(
    notification_id: uuid.UUID, _: TenantContextDep, uow: UoWDep
) -> Response:
    """Marca uma notificacao do usuario como lida. 404 se nao e dele."""
    await NotificationService(uow.session).mark_read(notification_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
