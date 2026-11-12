"""Coletor de erros do front: loga com o token ``app_error``, o mesmo do backend.

Sem auth (erro na tela de login nao tem token), campos truncados no servidor
e freio por IP, para um front em loop nao encher o log.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.rate_limit import client_error_limiter, rate_limit

logger = get_logger(__name__)

router = APIRouter(tags=["observability"])

# Limites de tamanho -- corta no servidor, nao confia no cliente.
_MAX_MSG = 500
_MAX_STACK = 2000
_MAX_FIELD = 300


class ClientErrorIn(BaseModel):
    """Payload minimo de um erro de front. Tudo opcional menos o tipo."""

    kind: str = Field(default="error")  # "error" | "unhandledrejection"
    message: str = Field(default="")
    source: str | None = None
    line: int | None = None
    col: int | None = None
    stack: str | None = None
    path: str | None = None  # location.pathname no momento do erro


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    return value[:limit]


@router.post(
    "/client-errors",
    status_code=status.HTTP_202_ACCEPTED,
    # Rota publica que escreve no log: o teto do sensor no cliente nao segura abuso.
    dependencies=[Depends(rate_limit(client_error_limiter))],
)
async def report_client_error(payload: ClientErrorIn, request: Request) -> None:
    """Loga um erro de front como ``app_error``."""
    logger.error(
        "app_error",
        code="client_error",
        kind=_clip(payload.kind, 40),
        message=_clip(payload.message, _MAX_MSG),
        source=_clip(payload.source, _MAX_FIELD),
        line=payload.line,
        col=payload.col,
        stack=_clip(payload.stack, _MAX_STACK),
        path=_clip(payload.path, _MAX_FIELD),
        ua=_clip(request.headers.get("user-agent"), _MAX_FIELD),
    )
    return None
