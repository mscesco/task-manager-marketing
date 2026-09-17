"""Router de notificacoes in-app (Spec 018, F4).

Rotas (sob /notifications):
    GET    /                       -- feed paginado (unread_only, type, task_id,
                                      project_id -- Spec 053, fatia E)
    GET    /targets?q=             -- sugestoes do filtro "Tarefa ou projeto"
    GET    /unread-count           -- contagem de nao-lidas (badge)
    POST   /read-all               -- marca como lidas (todas, ou as do filtro)
    POST   /{notification_id}/read -- marca uma como lida (404 se nao e sua)

Notificacao e PESSOAL: SEM require_permission no router -- a unica trava e
recipient == usuario logado, resolvida server-side no service/repository.
Por isso as rotas dependem so de TenantContextDep (autenticacao). Leitura
usa SessionDep; mutacao usa UoWDep (commit). Rotas estaticas vem antes da
dinamica para nao haver ambiguidade de match.
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
    # Spec 053, fatia E (D22). `type` repete: ?type=A&type=B.
    type: list[str] = Query(default_factory=list),
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> NotificationListResponse:
    """Feed do usuario logado, ultima mudanca primeiro."""
    result = await NotificationService(session).list_for_me(
        PageParams(page=page, size=size),
        unread_only=unread_only,
        tipos=tuple(type),
        task_id=task_id,
        project_id=project_id,
    )
    return NotificationListResponse(
        items=[NotificationResponse.model_validate(d) for d in result.items],
        total=result.total,
        page=result.page,
        size=result.size,
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    _: TenantContextDep, session: SessionDep
) -> UnreadCountResponse:
    """Contagem de nao-lidas (barato; o front polla isto pro badge)."""
    count = await NotificationService(session).count_unread()
    return UnreadCountResponse(count=count)


@router.get("/targets", response_model=AlvosResponse)
async def list_targets(
    _: TenantContextDep, session: SessionDep, q: str = ""
) -> AlvosResponse:
    """Sugestoes do filtro "Tarefa ou projeto" (Spec 053, D23)."""
    alvos = await NotificationService(session).alvos(q)
    return AlvosResponse(items=[AlvoResponse.model_validate(a) for a in alvos])


@router.post("/read-all", response_model=MarkAllReadResponse)
async def mark_all_read(
    _: TenantContextDep,
    uow: UoWDep,
    # Spec 053, fatia E (D25): os MESMOS filtros do GET. Sem nenhum, marca
    # todas -- o comportamento de sempre, que o sino usa.
    type: list[str] = Query(default_factory=list),
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> MarkAllReadResponse:
    """Marca as nao-lidas do usuario como lidas -- todas, ou as do filtro."""
    updated = await NotificationService(uow.session).mark_all_read(
        tipos=tuple(type), task_id=task_id, project_id=project_id
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
    """Marca UMA notificacao do usuario como lida. 404 se nao e dele."""
    await NotificationService(uow.session).mark_read(notification_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
