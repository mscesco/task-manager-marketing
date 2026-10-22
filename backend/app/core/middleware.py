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
        # Reaproveita o request_id do cliente se vier; senao gera.
        request_id = request.headers.get(_REQUEST_ID_HEADER) or str(uuid.uuid4())
        # Os handlers de erro leem daqui (`api/errors._error_body`).
        request.state.request_id = request_id

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


#: 10 MB. A maior requisicao legitima e a importacao de planilha da Base:
#: ate 7,2 MB de base64 (`_ImportFile.content_base64`). Subir aquele teto
#: exige subir este.
MAX_BODY_BYTES = 10 * 1024 * 1024


class BodySizeLimitMiddleware:
    """Recusa com 413 o corpo acima de `max_bytes`, ENQUANTO ele chega.

    ⚠️ Auditoria de 21/10: nada (Traefik, uvicorn, app) limitava o corpo, e o
    FastAPI le e decodifica o JSON inteiro ANTES de qualquer dependencia -- o
    freio por IP e os `max_length` do formulario publico rodavam depois. Um
    POST anonimo de 1 GB ocupava a memoria de um worker.

    Conta os bytes no `receive`, e nao pelo `Content-Length`: corpo em
    `chunked` nao traz o cabecalho. ASGI puro porque o `BaseHTTPMiddleware`
    nao deixa trocar o `receive`.

    ⚠️ TEM DE SER o `HTTPException` do Starlette: o FastAPI troca qualquer
    outro erro levantado na leitura do corpo por 400 "error parsing the body",
    e so deixa passar este (`fastapi/routing.py`).
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
