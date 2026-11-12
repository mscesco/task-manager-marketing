"""Unit of Work: fronteira transacional, o unico ponto que faz commit."""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)


class UnitOfWork:
    """Unit of Work base; modulos estendem com seus repositories.
    Sem `commit()` explicito, o `__aexit__` faz rollback."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._committed = False

    async def __aenter__(self) -> UnitOfWork:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            await self.rollback()
        elif not self._committed:
            await self.rollback()

    async def commit(self) -> None:
        """Confirma a transacao."""
        await self.session.commit()
        self._committed = True

    async def rollback(self) -> None:
        """Desfaz a transacao corrente."""
        await self.session.rollback()

