"""Middlewares: request_id e latencia no log, e teto de tamanho do corpo.

A autenticacao nao e middleware: e dependency por rota (auth.api.dependencies).
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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
        request_id = request.headers.get(_REQUEST_ID_HEADER) or str(uuid.uuid4())
        # Os handlers de erro leem daqui (`api/errors._error_body`).
        request.state.request_id = request_id

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


#: A maior requisicao legitima e a importacao de planilha da Base (ate 7,2 MB
#: de base64 em `_ImportFile.content_base64`); subir aquele teto exige subir este.
MAX_BODY_BYTES = 10 * 1024 * 1024


class BodySizeLimitMiddleware:
    """Recusa com 413 o corpo acima de `max_bytes`, enquanto ele chega.

    Conta no `receive`, nao pelo `Content-Length` (corpo `chunked` nao o traz).
    Tem de ser o `HTTPException` do Starlette: o FastAPI troca qualquer outro
    erro na leitura do corpo por 400.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        recebidos = 0

        async def receive_com_teto() -> Message:
            nonlocal recebidos
            message = await receive()
            if message["type"] == "http.request":
                recebidos += len(message.get("body", b""))
                if recebidos > self.max_bytes:
                    raise HTTPException(
                        status_code=413, detail="O conteudo enviado e grande demais."
                    )
            return message

        await self.app(scope, receive_com_teto, send)
