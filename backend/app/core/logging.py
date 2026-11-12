"""Logging estruturado com structlog (console no dev, JSON em producao).

O contexto da requisicao (request_id etc.) vem de app.core.middleware.
"""

from __future__ import annotations

import logging
import sys

import structlog

from app.core.config import LogFormat, settings


def configure_logging() -> None:
    """Configura structlog + stdlib logging. Chamar uma vez no startup."""

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,  # injeta request_id etc.
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.log_format == LogFormat.JSON:
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[settings.log_level.upper()]
        ),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

    # stdlib (uvicorn, sqlalchemy) no mesmo nivel.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=settings.log_level.upper(),
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Logger estruturado; o nome vai no campo `logger` (add_logger_name nao
    funciona com o PrintLogger)."""
    logger = structlog.get_logger()
    if name is not None:
        return logger.bind(logger=name)
    return logger
