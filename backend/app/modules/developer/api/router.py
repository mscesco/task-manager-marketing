"""Routers /me/api-keys e /me/webhooks: as chaves e os webhooks da própria pessoa (Spec 065).

Só com o login da tela (`ScreenLoginDep`): uma chave não mexe em chave nem em webhook.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import ScreenLoginDep
from app.modules.developer.api.schemas import (
    ApiKeyCreatedResponse,
    ApiKeyCreateRequest,
    ApiKeyResponse,
    WebhookCreatedResponse,
    WebhookCreateRequest,
    WebhookDeliveryResponse,
    WebhookResponse,
    WebhookUpdateRequest,
)
from app.modules.developer.application import api_keys, webhooks

router = APIRouter(prefix="/me/api-keys", tags=["developer"])


@router.get("", response_model=list[ApiKeyResponse])
async def listar(ctx: ScreenLoginDep, session: SessionDep) -> list[ApiKeyResponse]:
    return [ApiKeyResponse.model_validate(k) for k in await api_keys.listar(session, ctx)]


@router.post("", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def criar(
    payload: ApiKeyCreateRequest, ctx: ScreenLoginDep, uow: UoWDep
) -> ApiKeyCreatedResponse:
    registro, chave = await api_keys.criar(
        uow.session, ctx, name=payload.name, read_only=payload.read_only, days=payload.days
    )
    resposta = ApiKeyCreatedResponse(
        **ApiKeyResponse.model_validate(registro).model_dump(), key=chave
    )
    await uow.commit()
    return resposta


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def revogar(key_id: uuid.UUID, ctx: ScreenLoginDep, uow: UoWDep) -> Response:
    await api_keys.revogar(uow.session, ctx, key_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


webhooks_router = APIRouter(prefix="/me/webhooks", tags=["developer"])


@webhooks_router.get("", response_model=list[WebhookResponse])
async def listar_webhooks(ctx: ScreenLoginDep, session: SessionDep) -> list[WebhookResponse]:
    return [WebhookResponse.model_validate(w) for w in await webhooks.listar(session, ctx)]


@webhooks_router.post(
    "", response_model=WebhookCreatedResponse, status_code=status.HTTP_201_CREATED
)
async def criar_webhook(
    payload: WebhookCreateRequest, ctx: ScreenLoginDep, uow: UoWDep
) -> WebhookCreatedResponse:
    hook = await webhooks.criar(
        uow.session,
        ctx,
        url=payload.url,
        team_id=payload.team_id,
        board_id=payload.board_id,
        events=list(payload.events),
    )
    resposta = WebhookCreatedResponse(
        **WebhookResponse.model_validate(hook).model_dump(), secret=hook.secret
    )
    await uow.commit()
    return resposta


@webhooks_router.patch("/{webhook_id}", response_model=WebhookResponse)
async def editar_webhook(
    webhook_id: uuid.UUID, payload: WebhookUpdateRequest, ctx: ScreenLoginDep, uow: UoWDep
) -> WebhookResponse:
    hook = await webhooks.editar(
        uow.session,
        ctx,
        webhook_id,
        url=payload.url,
        events=list(payload.events) if payload.events is not None else None,
        is_active=payload.is_active,
    )
    resposta = WebhookResponse.model_validate(hook)
    await uow.commit()
    return resposta


@webhooks_router.delete(
    "/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def apagar_webhook(webhook_id: uuid.UUID, ctx: ScreenLoginDep, uow: UoWDep) -> Response:
    await webhooks.apagar(uow.session, ctx, webhook_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@webhooks_router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryResponse])
async def entregas_do_webhook(
    webhook_id: uuid.UUID, ctx: ScreenLoginDep, session: SessionDep
) -> list[WebhookDeliveryResponse]:
    return [
        WebhookDeliveryResponse.model_validate(e)
        for e in await webhooks.entregas(session, ctx, webhook_id)
    ]


@webhooks_router.post("/{webhook_id}/ping", response_model=WebhookDeliveryResponse)
async def testar_webhook(
    webhook_id: uuid.UUID, ctx: ScreenLoginDep, uow: UoWDep
) -> WebhookDeliveryResponse:
    """Manda um `ping` agora e devolve como foi (a entrega entra no histórico)."""
    entrega = await webhooks.testar(uow.session, ctx, webhook_id)
    resposta = WebhookDeliveryResponse.model_validate(entrega)
    await uow.commit()
    return resposta
