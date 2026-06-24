"""Dependency Injection central da aplicacao.

Aqui ficam as dependencies de INFRAESTRUTURA, usadas por
todos os modulos: sessao de banco e Unit of Work.

As dependencies de DOMINIO (usuario corrente, repositories
e services especificos) ficam em cada modulo -- ex.
app.modules.auth.api.dependencies, app.modules.tasks.api.dependencies.

Padrao FastAPI: estas funcoes sao usadas com Depends() nas
rotas. O escopo de uma sessao/UoW e UMA requisicao.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import db_manager
from app.db.unit_of_work import UnitOfWork


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Fornece uma AsyncSession com escopo de requisicao.

    A sessao e fechada ao fim da requisicao. O commit NAO e
    feito aqui -- e responsabilidade do Unit of Work, acionado
    pelo service. Em caso de excecao nao tratada, faz rollback
    defensivo antes de fechar.
    """
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
    """Fornece um Unit of Work sobre a sessao da requisicao.

    Cada modulo que precisar de um UoW com repositories
    especificos pode definir sua propria subclasse e
    dependency -- esta entrega o UoW base.
    """
    async with UnitOfWork(session) as uow:
        yield uow


# Type aliases para deixar as assinaturas das rotas limpas.
SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
UoWDep = Annotated[UnitOfWork, Depends(get_uow)]
