"""A varredura seleciona o MESMO conjunto de antes (Spec 035, criterio 5).

Este e o teste que define a fatia 2b. Trocar a fonte do relogio do
arquivamento e uma mudanca invisivel: nao tem tela, nao tem endpoint novo, nao
tem mensagem de erro. O unico jeito de saber que deu certo e provar que o
conjunto de tarefas que o job escolhe nao mudou.

⚠️ POR QUE A REGRA VELHA ESTA ESCRITA AQUI EM SQL CRU. Porque ela nao existe
mais no produto -- a fatia 2b a apagou. Um teste de equivalencia que chamasse a
regra nova dos dois lados nao provaria nada; provaria que a funcao e igual a si
mesma. O SQL abaixo e a copia literal do `list_stale_terminal` de ANTES da
fatia 2b, incluindo os filtros de tenant, soft-delete e arquivada que o
`_base_select` aplica.

⚠️ NOTA DE HARNESS, herdada do test_completion_cascade_db: o `db` roda tudo
numa transacao externa, entao `NOW()` e CONSTANTE no teste inteiro e nao da
para "esperar" o tempo passar. As datas sao plantadas explicitamente, e e o
que torna possivel simular o estado que a producao tem HOJE: o backfill da
0008/0009 gravou `terminal_since = COALESCE(completed_at, updated_at)` para
COMPLETED e `= updated_at` para CANCELLED.

Em producao, em 06/08/2026, os dois lados desta conta deram 212.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.db.models import Task
from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
DAYS = 20

# A regra de ANTES da fatia 2b, copiada do `list_stale_terminal` antigo.
# Mantida em SQL porque a versao Python dela nao existe mais no produto.
_REGRA_VELHA = """
    SELECT id FROM task
    WHERE workspace_id = :ws
      AND deleted_at IS NULL
      AND is_archived = false
      AND (
            (status = CAST('COMPLETED' AS task_status)
             AND completed_at IS NOT NULL
             AND completed_at < :cutoff)
         OR (status = CAST('CANCELLED' AS task_status)
             AND updated_at < :cutoff)
      )
"""


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=team, role="ADMIN"
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ws, team, admin, ctx


async def _plantar(
    db,
    *,
    ws: uuid.UUID,
    admin: uuid.UUID,
    team: uuid.UUID,
    status: TaskStatus,
    completed_at: datetime | None,
    updated_at: datetime,
    is_archived: bool = False,
    deleted: bool = False,
) -> uuid.UUID:
    """Cria a tarefa e planta as datas COMO A MIGRATION AS DEIXOU.

    `terminal_since` recebe exatamente a formula do backfill -- e o unico jeito
    de o teste falar do estado que existe em producao hoje.
    """
    t = await f.make_task(
        db, workspace_id=ws, created_by=admin, team_id=team, project_id=None
    )
    t.status = status
    t.completed_at = completed_at  # type: ignore[assignment]
    t.is_archived = is_archived
    if status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        t.terminal_since = (  # type: ignore[assignment]
            (completed_at or updated_at)
            if status == TaskStatus.COMPLETED
            else updated_at
        )
    if deleted:
        t.deleted_at = updated_at  # type: ignore[assignment]
    # updated_at por ultimo e explicito: setado a mao vence o onupdate do ORM.
    t.updated_at = updated_at  # type: ignore[assignment]
    await db.flush()
    return t.id


async def _conjunto_antigo(db, ws: uuid.UUID) -> set[uuid.UUID]:
    linhas = await db.execute(
        text(_REGRA_VELHA),
        {"ws": ws, "cutoff": NOW - timedelta(days=DAYS)},
    )
    return {r[0] for r in linhas}


async def test_o_conjunto_da_varredura_e_IDENTICO_ao_de_antes(db) -> None:
    """Os oito casos que separam as duas regras, num mundo so.

    Se a fatia 2b tivesse errado a formula, a diferenca apareceria como um id a
    mais ou a menos -- e a mensagem do assert diz qual.
    """
    ws, team, admin, ctx = await _mundo(db)

    velha_concluida = await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.COMPLETED,
        completed_at=_ago(30), updated_at=_ago(30),
    )
    velha_cancelada = await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.CANCELLED,
        completed_at=None, updated_at=_ago(30),
    )
    # Recentes: nenhuma das duas regras pega.
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.COMPLETED,
        completed_at=_ago(2), updated_at=_ago(2),
    )
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.CANCELLED,
        completed_at=None, updated_at=_ago(2),
    )
    # Viva e velha: nunca elegivel, por nenhuma das regras.
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.IN_PROGRESS,
        completed_at=None, updated_at=_ago(99),
    )
    # EXTERNAL_APPROVAL: entrou depois da Spec 013 e nao e terminal.
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.EXTERNAL_APPROVAL,
        completed_at=None, updated_at=_ago(99),
    )
    # Ja arquivada: nao reentra.
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.COMPLETED,
        completed_at=_ago(99), updated_at=_ago(99), is_archived=True,
    )
    # Soft-deletada: fora dos dois lados (o _base_select filtra).
    await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.COMPLETED,
        completed_at=_ago(99), updated_at=_ago(99), deleted=True,
    )
    await db.flush()

    antigo = await _conjunto_antigo(db, ws)

    with acting_as(**ctx):
        novo = {
            t.id
            for t in await TaskRepository(db).list_stale_terminal(
                now=NOW, days=DAYS
            )
        }

    assert antigo == {velha_concluida, velha_cancelada}, (
        "o setup nao reproduz a regra velha -- conserte o teste antes de "
        "olhar para o produto."
    )
    assert novo == antigo, (
        f"a varredura mudou de conjunto. Só na nova: {novo - antigo}. "
        f"Só na velha: {antigo - novo}."
    )


async def test_concluida_SEM_carimbo_continua_fora(db) -> None:
    """A regra velha nunca via a COMPLETED sem `completed_at`, e a nova nao
    pode passar a ver: seriam tarefas antigas arquivadas de uma vez na
    primeira madrugada.

    Em producao esse passivo e ZERO (medido em 06/08/2026), mas o backfill usa
    `COALESCE(completed_at, updated_at)` -- ou seja, se existisse, a linha
    ganharia data. Este teste fixa que ISSO nao aconteceu por acidente: aqui a
    tarefa e plantada SEM `terminal_since`, que e o estado de quem nunca foi
    datada.
    """
    ws, team, admin, ctx = await _mundo(db)
    t = await f.make_task(
        db, workspace_id=ws, created_by=admin, team_id=team, project_id=None
    )
    t.status = TaskStatus.COMPLETED
    t.completed_at = None  # type: ignore[assignment]
    t.terminal_since = None  # type: ignore[assignment]
    t.updated_at = _ago(99)  # type: ignore[assignment]
    await db.flush()

    assert await _conjunto_antigo(db, ws) == set()
    with acting_as(**ctx):
        novo = await TaskRepository(db).list_stale_terminal(now=NOW, days=DAYS)
    assert novo == []


async def test_editar_uma_CANCELADA_nao_adia_mais_o_arquivamento(db) -> None:
    """⚠️ A UNICA diferenca observavel entre as duas regras, e ela e
    DELIBERADA (D6).

    Antes: a regra lia `updated_at`, entao abrir uma tarefa cancelada ha dois
    meses e corrigir uma virgula adiava o arquivamento em mais 20 dias -- toda
    vez, sem ninguem perceber. Agora `terminal_since` fica congelado no momento
    do cancelamento e a edicao nao mexe nele.

    O teste existe para que a diferenca seja uma DECISAO registrada, e nao uma
    surpresa que alguem descubra em producao e trate como defeito.
    """
    ws, team, admin, ctx = await _mundo(db)
    alvo = await _plantar(
        db, ws=ws, admin=admin, team=team,
        status=TaskStatus.CANCELLED,
        completed_at=None, updated_at=_ago(60),
    )
    # Alguem passou por ela ontem: `updated_at` recente, `terminal_since` nao.
    obj = await db.get(Task, alvo)
    assert obj is not None
    obj.updated_at = _ago(1)  # type: ignore[assignment]
    await db.flush()

    assert await _conjunto_antigo(db, ws) == set(), (
        "a regra VELHA adiava o arquivamento por causa da edicao"
    )
    with acting_as(**ctx):
        novo = {
            t.id
            for t in await TaskRepository(db).list_stale_terminal(
                now=NOW, days=DAYS
            )
        }
    assert novo == {alvo}, (
        "a regra NOVA conta a partir do cancelamento, nao da ultima edicao"
    )
