"""Logging estruturado com structlog.

Em desenvolvimento: saida colorida e legivel no console.
Em staging/producao: JSON, pronto para ser coletado por
qualquer stack de observabilidade (Loki, ELK, Datadog).

Todo log carrega automaticamente o contexto da requisicao
(request_id, workspace_id, user_id) quando disponivel --
ver app.core.middleware, que popula esse contexto.
"""

from __future__ import annotations

import logging
import sys

import structlog

from app.core.config import LogFormat, settings


def configure_logging() -> None:
    """Configura structlog + stdlib logging. Chamar uma vez no startup."""

    # Processadores comuns a todos os ambientes.
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

    # Alinha o logging padrao da stdlib (usado por uvicorn, sqlalchemy)
    # ao nivel configurado, evitando ruido duplicado.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=settings.log_level.upper(),
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Retorna um logger estruturado. Use o __name__ do modulo como nome.

    O nome e vinculado como um campo `logger` do evento -- sem
    depender do processador add_logger_name da stdlib, que exige
    um logger da stdlib (incompativel com o PrintLogger usado).
    """
    logger = structlog.get_logger()
    if name is not None:
        return logger.bind(logger=name)
    return logger
