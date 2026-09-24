"""Coletor de erros do cliente (front).

Recebe um erro capturado no navegador (window.onerror /
unhandledrejection) e o loga no MESMO pipeline do backend, com o
token ``app_error`` -- para que o grep de deteccao ja existente
(status_code=5xx|app_error) passe a cobrir front e back juntos, sem
mudar o ritual.

Endpoint DELIBERADAMENTE:
  - responde 204 (sem corpo): o sensor nao pode gerar 5xx proprio,
    senao ele mesmo vira ruido no grep;
  - NAO exige auth: um erro na tela de login nao tem token, e e
    justamente esse caso (lider que nao consegue entrar) que
    interessa capturar;
  - TRUNCA os campos no servidor: um front em loop nao pode escrever
    linhas de log gigantes numa VPS compartilhada;
  - FREIA POR IP: truncar limita o TAMANHO de cada linha, nao quantas
    linhas chegam. As duas coisas sao necessarias.

Atribuicao de "qual usuario" NAO esta neste passo (endpoint sem
dependency de auth, nunca 401). Correlacao por horario + rota (`path`)
por ora; user_id fica como iteracao seguinte, se valer o custo.
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
    # ⚠️ FREIO POR IP (revisao de seguranca, 23/09). O teto de 20 do sensor e
    # do CLIENTE, e quem abusa nao usa o cliente: sem isto, a unica rota
    # publica que ESCREVE NO LOG aceitava requisicao sem limite -- disco da VPS
    # compartilhada, e o grep de deteccao afogado no proprio token que ele
    # procura (`app_error`).
    dependencies=[Depends(rate_limit(client_error_limiter))],
)
async def report_client_error(payload: ClientErrorIn, request: Request) -> None:
    """Loga um erro de front como ``app_error`` e responde 204.

    Reusa o token ``app_error`` de proposito (ver errors.py): o grep de
    deteccao ja existente casa com ele sem alteracao.
    """
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
