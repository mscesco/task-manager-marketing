"""O relogio do arquivamento (`terminal_since`) e escrito pelo produto.

⚠️ Se `terminal_since` ficar NULL numa tarefa concluida, a varredura de
arquivamento simplesmente nao a ve: sem excecao, sem log, so uma contagem menor.

  1. Nasce terminal -> nasce datada (inclusive CANCELLED, que `completed_at`
     nao conhece); nasce aberta -> sem relogio.
  2. Entra em terminal -> grava. Sai -> limpa (senao o job arquivaria tarefa
     viva).
  3. Terminal -> OUTRO terminal regrava: preservar a data antiga adiantaria o
     arquivamento.
  4. A cascata de conclusao (`UPDATE` textual, por fora do ORM) data os
     descendentes.

⚠️ O `db` roda tudo numa transacao externa, entao `NOW()` e constante no teste
inteiro: "a data nova e maior" nao distingue nada. Por isso o setup planta uma
SENTINELA antiga e o teste confere se ela foi sobrescrita.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.db.models import Task
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration

# Data claramente anterior ao teste. Se o produto escrever o campo, o valor
# deixa de ser esta sentinela; se nao escrever, permanece.
_SENTINELA = datetime(2020, 1, 1, tzinfo=UTC)


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    # ADMIN de organizacao: sem vinculo de time.
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    ana = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=ana, team_id=team, role="OPERATOR"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=admin, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        team_tree=(node(team),),
        org_role="ADMIN",
    )
    return ws, team, admin, ana, proj, ctx


async def _relogio(db, task_id: uuid.UUID) -> datetime | None:
    """Le `terminal_since` DO BANCO: a cascata escreve por UPDATE textual, por
    fora do identity map, e o atributo devolveria o valor velho."""
    return (
        await db.execute(
            text("SELECT terminal_since FROM task WHERE id = :i"),
            {"i": task_id},
        )
    ).scalar_one()


async def _plantar_sentinela(db, *tasks: Task) -> None:
    for t in tasks:
        t.terminal_since = _SENTINELA  # type: ignore[assignment]
    await db.flush()


# ---------------------------------------------------------------------------
# 1. Nascimento
# ---------------------------------------------------------------------------


async def test_tarefa_normal_nasce_SEM_relogio(db) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Em aberto",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
    assert await _relogio(db, t.id) is None


# ---------------------------------------------------------------------------
# 2 e 3. Transicoes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "destino", [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
)
async def test_entrar_em_terminal_liga_o_relogio(db, destino) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, t.id) is None
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=destino, fields_set=frozenset({"status"})
            ),
        )
    assert await _relogio(db, t.id) is not None


@pytest.mark.parametrize(
    "origem", [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
)
async def test_SAIR_de_terminal_desliga_o_relogio(db, origem) -> None:
    """Nascer terminal data a tarefa; reabrir desliga o relogio (senao ela seria
    arquivada de madrugada, viva). CANCELLED e o caso que `completed_at` nao
    cobre."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=origem,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, t.id) is not None
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.IN_PROGRESS,
                fields_set=frozenset({"status"}),
            ),
        )
    assert await _relogio(db, t.id) is None


async def test_de_um_terminal_para_o_OUTRO_regrava_o_relogio(db) -> None:
    """Cancelar uma concluida zera o relogio; manter a data antiga adiantaria o
    arquivamento."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=TaskStatus.COMPLETED,
                assignee_ids=[ana],
            )
        )
        obj = await db.get(Task, t.id)
        assert obj is not None
        await _plantar_sentinela(db, obj)

        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.CANCELLED,
                fields_set=frozenset({"status"}),
            ),
        )

    agora = await _relogio(db, t.id)
    assert agora is not None
    assert agora != _SENTINELA, (
        "mudar de COMPLETED para CANCELLED tem de REGRAVAR o relogio"
    )


async def test_editar_SEM_mexer_no_status_nao_toca_no_relogio(db) -> None:
    """Editar o titulo de uma concluida nao regrava a data (senao o
    arquivamento seria adiado a cada edicao)."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                status=TaskStatus.COMPLETED,
                assignee_ids=[ana],
            )
        )
        obj = await db.get(Task, t.id)
        assert obj is not None
        await _plantar_sentinela(db, obj)

        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                title="Peça revisada", fields_set=frozenset({"title"})
            ),
        )

    assert await _relogio(db, t.id) == _SENTINELA


# ---------------------------------------------------------------------------
# 4. A cascata (o UPDATE que o ORM nao ve)
# ---------------------------------------------------------------------------


async def test_cascata_de_conclusao_data_os_DESCENDENTES(db) -> None:
    """Os descendentes sao concluidos por `UPDATE` textual em massa, por fora
    do ORM. Sub direta e neta: o `<@ ltree` pega a subarvore inteira."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        pai = await TaskService(db).create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
        sub = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
                assignee_ids=[ana],
            )
        )
        neta = await TaskService(db).create(
            CreateTaskCommand(
                title="Corte",
                project_id=proj,
                team_id=team,
                parent_task_id=sub.id,
                assignee_ids=[ana],
            )
        )
        assert await _relogio(db, sub.id) is None
        assert await _relogio(db, neta.id) is None

        await TaskService(db).update(
            task_id=pai.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED,
                fields_set=frozenset({"status"}),
            ),
        )

    for filha, nome in ((sub, "subtarefa"), (neta, "neta")):
        assert await _relogio(db, filha.id) is not None, (
            f"a {nome} foi concluida pela cascata e ficou sem relogio: ela "
            "nunca seria arquivada, sem erro nenhum."
        )
