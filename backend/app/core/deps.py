"""Dependencies de infraestrutura (sessao e Unit of Work), com escopo de requisicao."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import db_manager
from app.db.unit_of_work import UnitOfWork


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """AsyncSession da requisicao. O commit e do Unit of Work, nao daqui."""
    session = db_manager.sessionmaker()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def get_uow(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AsyncIterator[UnitOfWork]:
    """Unit of Work base sobre a sessao da requisicao."""
    async with UnitOfWork(session) as uow:
        yield uow


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
UoWDep = Annotated[UnitOfWork, Depends(get_uow)]
