"""Middlewares da aplicacao.

RequestContextMiddleware:
    - gera/propaga um request_id por requisicao;
    - injeta esse request_id no contexto do structlog, de
      modo que TODO log da requisicao ja sai correlacionado;
    - mede a duracao da requisicao.

A autenticacao (resolver o JWT -> popular o TenantContext)
NAO e feita por middleware global, e sim por dependency
injection nas rotas protegidas (app.modules.auth.api.dependencies).
Motivo: rotas publicas (login, health) nao tem token, e um
middleware global de auth precisaria de uma lista de
excecoes fragil. DI deixa explicito, rota a rota, o que e
protegido.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger(__name__)

_REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Correlaciona logs por requisicao e mede latencia."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # Reaproveita o request_id do cliente se vier; senao gera.
        request_id = request.headers.get(_REQUEST_ID_HEADER) or str(uuid.uuid4())

        # Limpa e popula o contexto de logging desta requisicao.
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Excecao nao tratada: loga e deixa o handler global responder.
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.exception("request.failed", duration_ms=round(elapsed_ms, 2))
            raise

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "request.completed",
            status_code=response.status_code,
            duration_ms=round(elapsed_ms, 2),
        )
        response.headers[_REQUEST_ID_HEADER] = request_id
        return response
