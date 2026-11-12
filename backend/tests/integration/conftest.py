"""Harness dos testes de integracao contra Postgres real.

Banco descartavel (`db-test`), `alembic upgrade head` 1x por sessao, e cada
teste roda numa transacao externa com savepoint: o commit do codigo vira
SAVEPOINT e o rollback final desfaz tudo. Sem TEST_DATABASE_URL os testes sao
pulados (no CI, falham).
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
from app.modules.auth.domain.permissions import (
    permissions_for_actor,
    permissions_for_org_role,
    permissions_for_roles,
)

SCHEMA_BASE_REVISION = "0001_baseline_v5"

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def _bootstrapped_db_url() -> str:
    """Sobe o schema no banco de teste 1x por sessao. Pula se sem URL."""
    if not TEST_DATABASE_URL:
        # No CI pular sairia com codigo 0 e esconderia a suite inteira.
        if os.getenv("CI"):
            pytest.fail("TEST_DATABASE_URL ausente no CI -- a suite de integracao nao rodaria.")
        pytest.skip(
            "TEST_DATABASE_URL ausente -- suite de integracao pulada. "
            "Rode via: docker compose up -d db-test && docker compose run "
            "--rm -e TEST_DATABASE_URL=... api-dev pytest -m integration"
        )
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL}
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
    org_role: str | None = None,
) -> Iterator[TenantContext]:
    """Seta o TenantContext do teste com as permissoes montadas como na requisicao.

    Com `team_tree`, as permissoes sao escopadas por time (`permissions_for_actor`).
    Sem ela, caem na pergunta ampla: teste sobre escopo tem de passar `team_tree`,
    senao fica verde com a regra errada.
    """
    roles = frozenset(m.role for m in memberships) | (
        frozenset({org_role}) if org_role else frozenset()
    )
    with tenant_scope(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=roles,
        # Sem arvore nao ha descendentes para conceder ao papel de comando.
        permissions=(
            permissions_for_actor(
                memberships=memberships, tree=team_tree, org_role=org_role
            )
            if team_tree
            # ADMIN e papel de organizacao: sem a segunda parcela nao pode nada.
            else permissions_for_roles(roles) | permissions_for_org_role(org_role)
        ),
        memberships=memberships,
        team_tree=team_tree,
        # Sem isto `require_tenant().org_role` seria None nos testes.
        org_role=org_role,
    ) as ctx:
        yield ctx


def mship(team_id: uuid.UUID, role: str) -> Membership:
    """Atalho para montar uma Membership nos testes."""
    return Membership(team_id=team_id, role=role)


def node(team_id: uuid.UUID, parent_team_id: uuid.UUID | None = None) -> TeamNode:
    """Atalho para montar um TeamNode (arvore de times) nos testes."""
    return TeamNode(team_id=team_id, parent_team_id=parent_team_id)
