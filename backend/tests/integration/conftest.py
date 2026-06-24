"""Harness dos testes de INTEGRACAO (Entrega 5) -- contra Postgres real.

ESTRATEGIA (ADR 0014):
    - banco de teste descartavel (container `db-test` do compose), montado
      a partir do dump `schema/schema_v5.sql` via initdb;
    - bootstrap 1x por sessao: `alembic stamp <base> && alembic upgrade head`
      (aplica 0005+ por cima do dump) usando DATABASE_URL=TEST_DATABASE_URL;
    - isolamento por teste: conexao com transacao externa + AsyncSession com
      join_transaction_mode="create_savepoint"; o UoW.commit() do codigo vira
      SAVEPOINT e o rollback externo desfaz TUDO ao fim do teste.

A suite so roda se TEST_DATABASE_URL estiver setada -- senao os testes de
integracao sao PULADOS (a suite de logica pura continua rodando em qualquer
lugar). Marcador: @pytest.mark.integration (registrado no pyproject).

Bootstrap roda via subprocess `alembic` (caminho online/asyncpg do env.py;
nao precisa de psycopg2). O dump deve ter sido tirado no revision indicado
em SCHEMA_BASE_REVISION (ver plan.md, passo 0).
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)

from app.core.tenant import Membership, TeamNode, TenantContext, tenant_scope
from app.modules.auth.domain.permissions import permissions_for_roles

# dump tirado da produção em 0007,
# stamp aqui, upgrade aplica só 0008+
SCHEMA_BASE_REVISION = "0001_baseline_v5"

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def _bootstrapped_db_url() -> str:
    """Sobe o schema no banco de teste 1x por sessao. Pula se sem URL."""
    if not TEST_DATABASE_URL:
        pytest.skip(
            "TEST_DATABASE_URL ausente -- suite de integracao pulada. "
            "Rode via: docker compose up -d db-test && docker compose run "
            "--rm -e TEST_DATABASE_URL=... api-dev pytest -m integration"
        )
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL}
    # Entrega 8 (ADR 0022): banco de teste nasce VAZIO; o baseline 0001
    # constroi o schema inteiro. Sem stamp, sem dump -- so upgrade head.
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True
    )
    return TEST_DATABASE_URL


@pytest_asyncio.fixture
async def engine(_bootstrapped_db_url: str) -> AsyncIterator[AsyncEngine]:
    """Engine async por teste (evita atrito de loop com fixture de sessao)."""
    eng = create_async_engine(_bootstrapped_db_url, future=True)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest_asyncio.fixture
async def connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """Conexao com transacao EXTERNA -- revertida ao fim do teste."""
    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            yield conn
        finally:
            await trans.rollback()


@pytest_asyncio.fixture
async def db(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """Sessao de teste. commit() do codigo vira SAVEPOINT (rollback no fim)."""
    async with AsyncSession(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    ) as session:
        yield session


# --------------------------------------------------------
# Helper de contexto de tenant para os testes de servico
# --------------------------------------------------------
@contextmanager
def acting_as(
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    memberships: tuple[Membership, ...] = (),
    team_tree: tuple[TeamNode, ...] = (),
) -> Iterator[TenantContext]:
    """Seta o TenantContext do teste (reusa tenant_scope do app).

    permissions sao derivadas dos papeis das memberships -- mesmo caminho
    do get_tenant_context real.
    """
    roles = frozenset(m.role for m in memberships)
    with tenant_scope(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=roles,
        permissions=permissions_for_roles(roles),
        memberships=memberships,
        team_tree=team_tree,
    ) as ctx:
        yield ctx


def mship(team_id: uuid.UUID, role: str) -> Membership:
    """Atalho para montar uma Membership nos testes."""
    return Membership(team_id=team_id, role=role)


def node(team_id: uuid.UUID, parent_team_id: uuid.UUID | None = None) -> TeamNode:
    """Atalho para montar um TeamNode (arvore de times) nos testes."""
    return TeamNode(team_id=team_id, parent_team_id=parent_team_id)
