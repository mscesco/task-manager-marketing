"""Routers /me/api-keys e /dev: as chaves da própria pessoa e o mapa da API (Spec 065).

Só com o login da tela (`ScreenLoginDep`): uma chave não mexe em chave.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import ScreenLoginDep, TenantContextDep
from app.modules.developer.api.schemas import (
    ApiKeyCreatedResponse,
    ApiKeyCreateRequest,
    ApiKeyResponse,
)
from app.modules.developer.application import api_keys

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


dev_router = APIRouter(prefix="/dev", tags=["developer"])


@dev_router.get("/openapi")
async def referencia(request: Request, _: TenantContextDep) -> dict:
    """O mapa da API para a aba Referência: só para quem entrou, sem as rotas
    de sistema (as do n8n, por token). O `/docs` público segue desligado em produção."""
    schema = request.app.openapi()
    caminhos = {
        p: ops for p, ops in schema.get("paths", {}).items() if not p.startswith("/api/v1/system")
    }
    return {**schema, "paths": caminhos}
