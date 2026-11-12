"""Ambiente do Alembic (migrations async). A URL vem de `settings`, nao do alembic.ini."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.base import Base

# Importa todos os models para popular o metadata.
import app.db.models  # noqa: F401

config = context.config

# A URL nao passa por `config.set_main_option`: o ConfigParser interpreta `%`
# e uma senha com `%` derruba o `alembic upgrade`.

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


# Objetos do baseline sem model ORM, que o autogenerate tentaria dropar.
_UNMANAGED_NAMES = frozenset(
    {
        "task_history_immutable",          # funcao
        "task_history_no_update_delete",   # trigger
        "ltree",                           # extensao
        "pgcrypto",                        # extensao
    }
)


def include_object(
    obj: object,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: object | None,
) -> bool:
    """Filtra o que o Alembic nao gerencia: os nomes acima e os indices que
    so existem no banco (parciais, GIST), que nenhum model declara.

    O filtro de indice corta nos dois sentidos: indice novo entra por
    migration escrita a mao. O autogenerate contra `head` deve sair vazio.
    """
    if name in _UNMANAGED_NAMES:
        return False
    if type_ == "index" and reflected and compare_to is None:
        return False
    return True


def _configure_context(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
        compare_type=True,
        compare_server_default=True,
    )


def run_migrations_offline() -> None:
    """Modo offline: gera SQL sem conectar ao banco."""
    context.configure(
        url=settings.database_url_sync,
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    _configure_context(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Modo online: aplica migrations conectando via engine async."""
    configuration = config.get_section(config.config_ini_section, {})
    # Usa o driver async para a conexao online.
    configuration["sqlalchemy.url"] = str(settings.database_url)
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
