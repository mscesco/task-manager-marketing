"""Gerenciamento de conexao e sessao com o banco (async).

Centraliza:
    - a criacao do AsyncEngine (pool de conexoes);
    - a factory de AsyncSession;
    - o ciclo de vida (startup/shutdown).

O Postgres e EXTERNO (instancia da VPS). Este modulo so
abre conexoes via DATABASE_URL -- nao gerencia o servidor
de banco.

Regra de uso de sessao:
    - Em requisicoes HTTP: a sessao vem por DI
      (app.core.deps.get_db_session), com escopo de request.
    - Em jobs/scripts: use o context manager `session_scope()`.
Nunca instancie AsyncSession manualmente fora destes pontos.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class DatabaseManager:
    """Dono do engine e da session factory. Instanciado uma vez."""

    def __init__(self) -> None:
        self._engine: AsyncEngine | None = None
        self._sessionmaker: async_sessionmaker[AsyncSession] | None = None

    def init(self) -> None:
        """Cria engine + sessionmaker. Chamar no startup da app."""
        if self._engine is not None:
            return  # idempotente

        self._engine = create_async_engine(
            str(settings.database_url),
            echo=settings.db_echo,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
            # pool_pre_ping evita usar conexoes mortas pelo
            # firewall/idle-timeout da VPS.
            pool_pre_ping=True,
        )
        self._sessionmaker = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            expire_on_commit=False,  # objetos seguem usaveis pos-commit
            autoflush=False,
        )
        logger.info("database.initialized", pool_size=settings.db_pool_size)

    async def dispose(self) -> None:
        """Fecha o pool de conexoes. Chamar no shutdown da app."""
        if self._engine is not None:
            await self._engine.dispose()
            self._engine = None
            self._sessionmaker = None
            logger.info("database.disposed")

    @property
    def engine(self) -> AsyncEngine:
        if self._engine is None:
            raise RuntimeError("DatabaseManager nao inicializado. Chame init().")
        return self._engine

    @property
    def sessionmaker(self) -> async_sessionmaker[AsyncSession]:
        if self._sessionmaker is None:
            raise RuntimeError("DatabaseManager nao inicializado. Chame init().")
        return self._sessionmaker

    @asynccontextmanager
    async def session_scope(self) -> AsyncIterator[AsyncSession]:
        """Context manager de sessao para jobs/scripts/workers.

        Faz commit ao sair sem erro, rollback em excecao, e
        sempre fecha a sessao. Para requisicoes HTTP, use a
        dependency get_db_session (que delega o commit ao
        Unit of Work).
        """
        session = self.sessionmaker()
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Instancia unica usada por toda a aplicacao.
db_manager = DatabaseManager()
