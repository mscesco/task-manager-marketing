"""Traducao de excecoes de dominio para respostas HTTP.

ESTE E O UNICO LUGAR que conhece ao mesmo tempo as
excecoes de dominio E o HTTP. As camadas de dominio,
aplicacao e repositories lancam AppError (e subclasses) sem
saber que existe HTTP -- aqui isso vira status code + JSON.

Formato de erro (estavel, para o frontend consumir)::

    {
      "error": {
        "code": "entity_not_found",
        "message": "Task nao encontrado(a).",
        "details": {"entity": "Task", "identifier": "..."}
      },
      "request_id": "..."
    }
"""

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger
from app.shared.exceptions.base import (
    AppError,
    AuthenticationError,
    AuthorizationError,
    BusinessRuleError,
    ConflictError,
    DomainError,
    EntityNotFoundError,
    InfrastructureError,
    PasswordChangeRequiredError,
    RateLimitError,
    ValidationError,
)

logger = get_logger(__name__)

# Mapa excecao -> status HTTP. Mais especifico antes do generico.
_STATUS_MAP: list[tuple[type[AppError], int]] = [
    (EntityNotFoundError, status.HTTP_404_NOT_FOUND),
    (ConflictError, status.HTTP_409_CONFLICT),
    (ValidationError, status.HTTP_422_UNPROCESSABLE_ENTITY),
    (PasswordChangeRequiredError, status.HTTP_409_CONFLICT),
    (BusinessRuleError, status.HTTP_409_CONFLICT),
    (RateLimitError, status.HTTP_429_TOO_MANY_REQUESTS),
    (AuthenticationError, status.HTTP_401_UNAUTHORIZED),
    (AuthorizationError, status.HTTP_403_FORBIDDEN),
    (DomainError, status.HTTP_400_BAD_REQUEST),
    (InfrastructureError, status.HTTP_500_INTERNAL_SERVER_ERROR),
]


def _status_for(exc: AppError) -> int:
    for exc_type, http_status in _STATUS_MAP:
        if isinstance(exc, exc_type):
            return http_status
    return status.HTTP_500_INTERNAL_SERVER_ERROR


def _error_body(
    *, code: str, message: str, request: Request, details: dict | None = None
) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
        "request_id": request.headers.get("X-Request-ID"),
    }


async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Handler de todas as AppError."""
    http_status = _status_for(exc)

    # 5xx => erro nosso, loga como erro. 4xx => esperado, loga leve.
    if http_status >= 500:
        logger.error("app_error", code=exc.code, message=exc.message)
    else:
        logger.info("app_error.handled", code=exc.code, status=http_status)

    # 429 carrega Retry-After (segundos) -- padrao HTTP, o cliente respeita.
    headers: dict[str, str] | None = None
    retry_after = exc.details.get("retry_after")
    if retry_after is not None:
        headers = {"Retry-After": str(retry_after)}

    return JSONResponse(
        status_code=http_status,
        content=_error_body(
            code=exc.code,
            message=exc.message,
            request=request,
            details=exc.details,
        ),
        headers=headers,
    )


async def _validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Erros de validacao do Pydantic/FastAPI (schema de request)."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(
            code="request_validation_error",
            message="Dados da requisicao invalidos.",
            request=request,
            details={"errors": exc.errors()},
        ),
    )


async def _unhandled_error_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Rede de seguranca: qualquer excecao nao prevista vira 500 limpo.

    NUNCA vaza stacktrace para o cliente -- o detalhe vai
    para o log (com request_id), a resposta e generica.
    """
    logger.exception("unhandled_exception")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_error_body(
            code="internal_error",
            message="Erro interno inesperado.",
            request=request,
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Registra todos os handlers na app. Chamado no bootstrap."""
    app.add_exception_handler(AppError, _app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(
        RequestValidationError, _validation_error_handler  # type: ignore[arg-type]
    )
    app.add_exception_handler(Exception, _unhandled_error_handler)
