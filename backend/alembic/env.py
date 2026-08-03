"""Alembic environment -- migrations async.

Pontos importantes desta configuracao:

  - A URL do banco vem de app.core.config.settings (.env),
    nao do alembic.ini. Uma fonte de verdade.

  - O `target_metadata` e o Base.metadata da aplicacao,
    com TODOS os models importados -- e o que permite o
    autogenerate comparar ORM x banco.

  - SOBRE O SCHEMA v5 JA EXISTENTE:
    O banco task_manager_dev ja foi criado a partir do
    schema_v5.sql. Para o Alembic NAO tentar recriar tudo,
    o fluxo correto e:
        1. gerar a migration inicial (autogenerate);
        2. revisar -- ela deve sair (quase) vazia se os
           models batem com o schema;
        3. aplicar `alembic stamp head` para marcar o banco
           como ja na versao inicial, SEM rodar DDL.
    A partir dai, novas migrations evoluem o schema
    normalmente. Detalhes no README.

  - Objetos que o Alembic nao deve gerenciar (a trigger de
    imutabilidade, a extensao ltree/pgcrypto) sao filtrados
    em `include_object`, pois vivem no schema SQL versionado
    a parte, nao nos models ORM.
"""

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

# Injeta a URL (sincrona p/ o Alembic) vinda do .env.
config.set_main_option("sqlalchemy.url", settings.database_url_sync)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


# Objetos criados pelo baseline (0001) que NAO tem model ORM e que o
# autogenerate, se deixado solto, tentaria dropar. Nomes conferidos
# contra o schema real (Entrega 8): a funcao e a trigger de
# imutabilidade de task_history, e as extensoes.
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
    """Filtra objetos que o Alembic NAO deve gerenciar.

    Dois filtros, por motivos diferentes:

    1. NOMES do baseline 0001 sem model ORM (a funcao
       task_history_immutable(), a trigger
       task_history_no_update_delete, as extensoes ltree/pgcrypto).
       Sem o filtro, um autogenerate futuro emitiria DROP neles.

    2. INDICES que existem no BANCO e nao no metadata
       (`reflected and compare_to is None`). O baseline 0001 criou
       33 indices -- parciais (`WHERE deleted_at IS NULL`), GIST de
       ltree, e os herdados de 0004/0006 -- que nenhum model declara.
       Sem o filtro, todo autogenerate nascia com 33 `drop_index`.
       Indice perdido em producao NAO da erro: da lentidao tres
       semanas depois, sem ninguem ligar uma coisa na outra.

    ⚠️ O filtro 2 corta nos DOIS sentidos: indice declarado so no
    ORM tambem para de ser gerado. Indice novo entra por migration
    escrita a mao, como todos os outros deste repo ja entraram.

    ⚠️ Meta a defender: `alembic revision --autogenerate` contra um
    banco em `head` tem que sair VAZIO (so `pass`). Enquanto nao
    sair, o diff nao e revisavel -- e diff nao revisavel e aplicado
    no escuro. Se voltar a sair sujo, o model divergiu do banco;
    conserte o model, nao o filtro.
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
