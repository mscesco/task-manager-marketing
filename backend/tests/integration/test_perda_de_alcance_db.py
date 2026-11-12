"""O predicado `bloqueios_por_perda_de_alcance`.

    "Dado o conjunto de times que a pessoa teria DEPOIS da mudanca, de quais
    tarefas NAO-TERMINAIS ela e a UNICA responsavel e deixaria de alcancar?"

⚠️ Terminal vem da SEMANTICA da coluna (`TERMINAL_SEMANTICS` = {DONE,
CANCELLED}), nao de uma lista de status: coluna criada por gente nao tem
`legacy_status`.

O MUNDO (`_mundo`): raiz Marketing + subtimes SEO e Design.
    `gi` e OPERATOR do Design. A lente dela e {Design, raiz}; o cenario e
    "ela sai do Design", entao `times_depois = {raiz}`.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Predicado")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gi, team_id=design, role="OPERATOR"
    )
    outra = await f.make_user(db, workspace_id=ws, email="outra@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=outra, team_id=design, role="OPERATOR"
    )

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=gi,
        roles=frozenset({"OPERATOR"}),
        permissions=frozenset(),
        memberships=(Membership(team_id=design, role="OPERATOR"),),
        team_tree=arvore,
    )
    set_tenant(ctx)

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "design": design,
        "gi": gi,
        "outra": outra,
        # A lente DEPOIS de sair do Design: so a raiz.
        "depois": frozenset({raiz}),
    }


async def _com_responsavel(db, m, *, task, quem):
    await f.make_assignment(
        db,
        workspace_id=m["ws"],
        task_id=task.id,
        user_id=quem,
        assigned_by=m["gi"],
    )


_PADRAO = object()  # sentinela: `depois=None` significa ADMIN, nao "use o padrao"


async def _bloqueios(db, m, *, depois=_PADRAO):
    return await TaskRepository(db).bloqueios_por_perda_de_alcance(
        user_id=m["gi"],
        times_depois=m["depois"] if depois is _PADRAO else depois,
    )


# ------------------------------------------------------------- os seis casos


async def test_1_unica_responsavel_em_subtime_que_ela_perde_bloqueia(db) -> None:
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte do lancamento",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    bloqueios = await _bloqueios(db, m)

    assert [b.task_id for b in bloqueios] == [t.id]
    # Afirma os CAMPOS, nao so o tamanho.
    b = bloqueios[0]
    assert b.titulo == "Arte do lancamento"
    assert b.team_id == m["design"]
    assert b.subtime == "design"
    assert b.coluna == "Backlog"


async def test_2_mesma_tarefa_em_coluna_terminal_nao_bloqueia(db) -> None:
    """Terminal nao barra ninguem: ninguem vai retomar trabalho em `Concluido`.

    Cai se `TERMINAL_SEMANTICS` ficar vazio.
    """
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte ja entregue",
        status=TaskStatus.COMPLETED,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m) == []


async def test_3_dois_responsaveis_nao_bloqueia(db) -> None:
    """Ela nao e a UNICA -- a tarefa continua com dono depois que ela sai."""
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte a quatro maos",
        status=TaskStatus.IN_PROGRESS,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])
    await _com_responsavel(db, m, task=t, quem=m["outra"])

    assert await _bloqueios(db, m) == []


async def test_4_tarefa_na_raiz_nao_bloqueia(db) -> None:
    """Ninguem perde a raiz de vista: so tarefa de subtime pode barrar."""
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["raiz"],
        title="Tarefa geral",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m) == []


async def test_5_subtime_que_ela_mantem_nao_bloqueia(db) -> None:
    """Cenario de rebaixamento parcial: ela sai do Design mas fica no SEO."""
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["seo"],
        title="Tarefa do SEO",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    depois = frozenset({m["raiz"], m["seo"]})
    assert await _bloqueios(db, m, depois=depois) == []


async def test_6_arquivada_ou_apagada_nao_bloqueia(db) -> None:
    """⚠️ SAO DOIS ESTADOS, e cada um sozinho deixaria metade do passivo vivo.

    `is_archived` e `deleted_at` sao independentes (`ArchivableMixin` /
    `SoftDeleteMixin`): arquivar nao apaga. Um filtro so faria a pessoa ser
    barrada por trabalho que ninguem enxerga mais.
    """
    m = await _mundo(db)
    arquivada = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arquivada",
        status=TaskStatus.BACKLOG,
    )
    arquivada.is_archived = True
    apagada = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Apagada",
        status=TaskStatus.BACKLOG,
    )
    apagada.deleted_at = datetime.now(UTC)
    await db.flush()

    await _com_responsavel(db, m, task=arquivada, quem=m["gi"])
    await _com_responsavel(db, m, task=apagada, quem=m["gi"])

    assert await _bloqueios(db, m) == []


# ------------------------------------- os dois que o plano nao pedia


async def test_7_admin_nao_bloqueia_nada(db) -> None:
    """⚠️ `times_depois=None` = ADMIN: ele continua alcancando tudo.

    Escrever o predicado como `team_id not in (times_depois or set())` barraria
    o ADMIN em TODAS as tarefas -- erro plausivel, e nenhum dos seis testes
    acima o pegaria, porque todos passam um conjunto de verdade.
    """
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte do lancamento",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m, depois=None) == []


# Sem teste de tenant de proposito: as FKs compostas `(user_id, workspace_id)`
# tornam o cenario inconstruivel (uma pessoa em dois workspaces tem dois
# `user_id`), entao filtrar por `user_id` ja escopa o tenant. O filtro de
# workspace da consulta e defesa barata, sem teste que possa falhar.
