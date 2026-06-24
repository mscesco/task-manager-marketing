"""Bootstrap da aplicacao FastAPI.

Este arquivo so MONTA a aplicacao -- nenhuma regra de
negocio. Responsabilidades:
    - configurar logging;
    - gerenciar o ciclo de vida (lifespan): abrir/fechar o
      pool de conexoes do banco;
    - registrar middlewares;
    - registrar exception handlers;
    - registrar os routers.

A instancia `app` daqui e o que o uvicorn sobe
(app.main:app).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.router import api_v1_router, infra_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.db.session import db_manager

# Garante que TODOS os models sejam registrados no metadata
# (necessario antes de qualquer uso do ORM / Alembic).
import app.db.models  # noqa: F401

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Ciclo de vida da aplicacao.

    Startup: inicializa o pool de conexoes com o Postgres
    externo. Shutdown: fecha o pool de forma limpa.
    """
    logger.info("app.starting", env=settings.app_env.value)
    db_manager.init()
    try:
        yield
    finally:
        await db_manager.dispose()
        logger.info("app.stopped")


def create_app() -> FastAPI:
    """Factory da aplicacao. Facilita testes (cada teste cria a sua)."""
    configure_logging()

    app = FastAPI(
        title="Task Manager API",
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

    # --- Exception handlers ---
    register_exception_handlers(app)

    # --- Rotas ---
    app.include_router(infra_router)
    app.include_router(api_v1_router)

    logger.info("app.configured")
    return app


# Instancia que o uvicorn carrega.
app = create_app()
