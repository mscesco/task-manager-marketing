"""Monta a aplicacao FastAPI (app.main:app): logging, lifespan, middlewares,
handlers e rotas."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

# Registra todos os models no metadata antes de qualquer uso do ORM.
import app.db.models
from app.api.errors import register_exception_handlers
from app.api.router import api_v1_router, infra_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.db.session import db_manager

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Abre o pool do banco no startup e fecha no shutdown."""
    logger.info("app.starting", env=settings.app_env.value)
    db_manager.init()
    try:
        yield
    finally:
        # A conexao de escuta do ao vivo sai do pool e tem de voltar antes de ele fechar.
        from app.modules.bases.infrastructure.live import hub

        await hub.close()
        await db_manager.dispose()
        logger.info("app.stopped")


def create_app() -> FastAPI:
    """Factory da aplicacao (testes criam a sua)."""
    configure_logging()

    app = FastAPI(
        title="Oniros API",
        version="0.1.0",
        description="Sistema de gestao de demandas/tarefas multi-tenant.",
        # Docs interativas so fora de producao.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )

    # --- Middlewares (ordem importa: o ultimo adicionado roda primeiro) ---
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(RequestContextMiddleware)
    # Por ultimo = roda primeiro: o teto vale antes de qualquer leitura.
    app.add_middleware(BodySizeLimitMiddleware)

    register_exception_handlers(app)

    app.include_router(infra_router)
    app.include_router(api_v1_router)

    logger.info("app.configured")
    return app


app = create_app()
