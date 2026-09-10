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
from app.modules.auth.domain.permissions import (
    permissions_for_actor,
    permissions_for_roles,
)

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
    org_role: str | None = None,
) -> Iterator[TenantContext]:
    """Seta o TenantContext do teste (reusa tenant_scope do app).

    ⚠️⚠️ AS PERMISSOES SAO MONTADAS **COM ESCOPO**, por `permissions_for_actor`
    -- o mesmo caminho de `get_tenant_context`. Ate 09/09 este helper passava
    um `frozenset` de `permissions_for_roles`, e isso tornava INVISIVEL nos
    testes toda regra escopada por time.

    O motivo esta escrito em `TenantContext.has_permission_in`: quando
    `permissions` nao tem `can_in` (ou seja, e um `frozenset`), ele CAI PARA A
    PERGUNTA AMPLA, de proposito e fail-open. Com um `frozenset` aqui,
    "tem `team.manage` NAQUELA arvore" respondia igual a "tem `team.manage`
    em algum lugar" -- e um teste de duas areas passaria verde com a regra
    errada.

    ⚠️ E o comentario de la ja anunciava esta troca: *"E fail-OPEN (...)
    enquanto houver uma raiz so, as duas respostas coincidem em todo caso
    real. A fatia D estreita isto quando o cadastro permitir."* O cadastro
    permitiu na Spec 046; a troca e esta.

    ⚠️ `org_role` entra como parametro proprio porque papel de ORGANIZACAO nao
    tem time (Spec 045, fatia B) -- quem administra a organizacao alcanca
    tudo, e isso nao sai de `memberships`.
    """
    roles = frozenset(m.role for m in memberships) | (
        frozenset({org_role}) if org_role else frozenset()
    )
    with tenant_scope(
        workspace_id=workspace_id,
        user_id=user_id,
        roles=roles,
        # ⚠️⚠️ SO ESCOPA QUANDO A ARVORE FOI DECLARADA, e isto e uma escolha,
        # nao um atalho. `permissions_for_actor` concede ao papel de COMANDO o
        # time do vinculo MAIS OS DESCENDENTES -- e sem `team_tree` nao ha de
        # onde tirar descendente nenhum. Um MANAGER da raiz ficaria com
        # `team.manage` SO na raiz e seria recusado ao mexer num subtime.
        #
        # Dezenas de testes antigos nao passam `team_tree` porque nunca
        # precisaram: a pergunta deles nao e sobre escopo. Escopar todos de uma
        # vez quebraria 31 deles por um motivo que nao e o assunto de nenhum.
        #
        # ⚠️ E A REGRA PARA QUEM ESCREVE TESTE NOVO: se a sua pergunta e sobre
        # ESCOPO -- quem alcanca qual arvore --, PASSE `team_tree`. Sem ela o
        # contexto cai na pergunta ampla (`has_permission_in` e fail-open com
        # `frozenset`), e o teste fica verde com a regra errada.
        permissions=(
            permissions_for_actor(
                memberships=memberships, tree=team_tree, org_role=org_role
            )
            if team_tree
            else permissions_for_roles(roles)
        ),
        memberships=memberships,
        team_tree=team_tree,
        # ⚠️⚠️ SEM ESTA LINHA, TODA REGRA DE PAPEL DE ORGANIZACAO FICAVA
        # INVISIVEL NOS TESTES. O `org_role` entrava so em `roles` e em
        # `permissions_for_actor` -- `require_tenant().org_role` respondia
        # `None` mesmo com `acting_as(..., org_role="ADMIN")`.
        #
        # Achado em 10/09, escrevendo a abertura do anti-lockout para quem
        # administra a organizacao: o teste falhava com a regra CERTA. E a
        # mesma classe do defeito que este helper ja registra logo acima --
        # o contexto do teste diferindo do contexto da requisicao.
        org_role=org_role,
    ) as ctx:
        yield ctx


def mship(team_id: uuid.UUID, role: str) -> Membership:
    """Atalho para montar uma Membership nos testes."""
    return Membership(team_id=team_id, role=role)


def node(team_id: uuid.UUID, parent_team_id: uuid.UUID | None = None) -> TeamNode:
    """Atalho para montar um TeamNode (arvore de times) nos testes."""
    return TeamNode(team_id=team_id, parent_team_id=parent_team_id)
