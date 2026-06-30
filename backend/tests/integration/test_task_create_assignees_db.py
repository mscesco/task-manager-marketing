"""Criacao de task com responsaveis (Spec 021, Fatia 1): grava + history +
notificacao; atomico (invalido -> 422 listando todos, NADA persiste); dedup.

Atomicidade: o create() da flush ANTES de validar os assignees, entao pra
observar o 'reverteu tudo' a criacao que falha roda dentro de um
begin_nested() -- que simula a unit-of-work da requisicao (o router so commita
no sucesso). Ao estourar, o savepoint reverte task + history + assignment.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _setup(db):
    """WS com raiz R + subtimes A e B; manager de R (cria/edita a subarvore);
    projeto comum no time A; op_a alcanca A; op_b so alcanca B."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (node(r), node(a, r), node(b, r))
    mgr_ctx = dict(
        workspace_id=ws,
        user_id=manager,
        memberships=(mship(r, "MANAGER"),),
        team_tree=forest,
    )
    return ws, a, b, manager, op_a, op_b, proj, mgr_ctx


async def _count_assign(db, task_id):
    return (
        await db.execute(
            text("SELECT count(*) FROM task_assignment WHERE task_id=:i"),
            {"i": task_id},
        )
    ).scalar_one()


async def _count_tasks(db, ws):
    return (
        await db.execute(
            text("SELECT count(*) FROM task WHERE workspace_id=:w"), {"w": ws}
        )
    ).scalar_one()


async def _count_hist_assigned(db, task_id):
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM task_history "
                "WHERE task_id=:i AND event_type='assigned'"
            ),
            {"i": task_id},
        )
    ).scalar_one()


async def _count_notif(db, recipient, task_id):
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM notification "
                "WHERE recipient_id=:r AND task_id=:t"
            ),
            {"r": recipient, "t": task_id},
        )
    ).scalar_one()


async def test_cria_com_assignee_valido_grava_history_e_notifica(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(
                title="Com responsavel", project_id=proj, team_id=a,
                assignee_ids=[op_a],
            )
        )
    assert await _count_assign(db, task.id) == 1
    assert await _count_hist_assigned(db, task.id) == 1
    # op_a e terceiro -> recebe notificacao.
    assert await _count_notif(db, op_a, task.id) == 1


async def test_cria_com_varios_self_nao_notifica(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(
                title="Eu e o op_a", project_id=proj, team_id=a,
                assignee_ids=[op_a, manager],
            )
        )
    assert await _count_assign(db, task.id) == 2
    assert await _count_notif(db, op_a, task.id) == 1
    # auto-designacao do criador NAO notifica (emitter trata).
    assert await _count_notif(db, manager, task.id) == 0


async def test_assignee_invalido_falha_422_e_nao_persiste(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        with pytest.raises(ValidationError) as ei:
            # begin_nested = fronteira da requisicao: ao estourar, reverte tudo.
            async with db.begin_nested():
                await TaskService(db).create(
                    CreateTaskCommand(
                        title="Invalido", project_id=proj, team_id=a,
                        assignee_ids=[op_b],  # op_b nao alcanca o time A
                    )
                )
    assert ei.value.code == "validation_error"
    assert ei.value.details["invalid_ids"] == [str(op_b)]
    # Nada criado: nem a task, nem assignment.
    assert await _count_tasks(db, ws) == 0


async def test_mistura_valido_invalido_nomeia_so_invalido_e_reverte(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        with pytest.raises(ValidationError) as ei:
            async with db.begin_nested():
                await TaskService(db).create(
                    CreateTaskCommand(
                        title="Meio e meio", project_id=proj, team_id=a,
                        assignee_ids=[op_a, op_b],
                    )
                )
    # so o invalido e nomeado; o valido nao entra na lista.
    assert ei.value.details["invalid_ids"] == [str(op_b)]
    assert await _count_tasks(db, ws) == 0


async def test_dedup_id_repetido_vira_um(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(
                title="Repetido", project_id=proj, team_id=a,
                assignee_ids=[op_a, op_a],
            )
        )
    assert await _count_assign(db, task.id) == 1


async def test_sem_assignees_comportamento_de_hoje(db) -> None:
    ws, a, b, manager, op_a, op_b, proj, mgr_ctx = await _setup(db)
    with acting_as(**mgr_ctx):
        task = await TaskService(db).create(
            CreateTaskCommand(title="Sem ninguem", project_id=proj, team_id=a)
        )
    assert await _count_assign(db, task.id) == 0
