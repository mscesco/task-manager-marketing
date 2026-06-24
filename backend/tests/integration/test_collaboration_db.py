"""Assignment + Watchers no banco: 404/409/422 + idempotencia + history."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.collaboration_service import CollaborationService
from app.modules.tasks.application.task_service import (
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """WS com raiz R + subtimes A e B; manager de R; projeto comum team A."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (node(r), node(a, r), node(b, r))
    mgr_ctx = dict(
        workspace_id=ws, user_id=manager, memberships=(mship(r, "MANAGER"),), team_tree=forest
    )
    return ws, r, a, b, manager, proj, forest, mgr_ctx


async def _count_assign(db, task_id):
    return (
        await db.execute(
            text("SELECT count(*) FROM task_assignment WHERE task_id=:i"), {"i": task_id}
        )
    ).scalar_one()


async def test_add_assignee_cria_linha_e_history(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        _, created = await CollaborationService(db).add_assignee(task_id=task.id, user_id=alvo)
    assert created is True
    assert await _count_assign(db, task.id) == 1
    hist = (
        (
            await db.execute(
                text(
                    "SELECT metadata FROM task_history WHERE task_id=:i AND event_type='assigned'"
                ),
                {"i": task.id},
            )
        )
        .scalars()
        .all()
    )
    assert len(hist) == 1
    assert hist[0]["user_id"] == str(alvo)
    assert hist[0]["assigned_by"] == str(manager)


async def test_add_assignee_idempotente(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        svc = CollaborationService(db)
        await svc.add_assignee(task_id=task.id, user_id=alvo)
        _, created2 = await svc.add_assignee(task_id=task.id, user_id=alvo)
    assert created2 is False
    assert await _count_assign(db, task.id) == 1
    hist = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type='assigned'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert hist == 1  # no-op nao gera 2a linha


async def test_remove_assignee_history_e_404(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        svc = CollaborationService(db)
        await svc.add_assignee(task_id=task.id, user_id=alvo)
        await svc.remove_assignee(task_id=task.id, user_id=alvo)
        assert await _count_assign(db, task.id) == 0
        with pytest.raises(EntityNotFoundError):
            await svc.remove_assignee(task_id=task.id, user_id=alvo)
    un = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type='unassigned'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert un == 1


async def test_pessoal_monouser_409(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    dono = await f.make_user(db, workspace_id=ws)
    outro = await f.make_user(db, workspace_id=ws)
    pessoal = await f.make_project(
        db, workspace_id=ws, created_by=dono, team_id=None, is_personal=True
    )
    task = await f.make_task(db, workspace_id=ws, created_by=dono, team_id=None, project_id=pessoal)
    with acting_as(workspace_id=ws, user_id=dono):
        with pytest.raises(ConflictError):
            await CollaborationService(db).add_assignee(task_id=task.id, user_id=outro)


async def test_assignee_fora_de_alcance_422(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    # alvo so do subtime B -> lente {B,R}; task do projeto team A -> nao alcanca
    alvo_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo_b, team_id=b, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        with pytest.raises(ValidationError):
            await CollaborationService(db).add_assignee(task_id=task.id, user_id=alvo_b)


async def test_operator_designa_no_quadro_geral(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    colega = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=colega, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=op, team_id=a, project_id=proj)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        _, created = await CollaborationService(db).add_assignee(task_id=task.id, user_id=colega)
    assert created is True


async def test_assignment_nao_concede_edicao(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    # task do projeto (team A) mas com team B; opA ve (projeto) mas nao edita (team B)
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=b, project_id=proj)
    with acting_as(**mgr_ctx):
        await CollaborationService(db).add_assignee(task_id=task.id, user_id=op_a)
    # op_a agora e responsavel, mas continua sem poder editar (team B fora da lente dele)
    with acting_as(
        workspace_id=ws, user_id=op_a, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        with pytest.raises(AuthorizationError):
            await TaskService(db).update(task_id=task.id, command=UpdateTaskCommand(title="x"))


async def test_watcher_self_sem_permissao_sem_history(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        _, created = await CollaborationService(db).add_watcher(task_id=task.id, user_id=None)
    assert created is True
    w = (
        await db.execute(
            text("SELECT count(*) FROM task_watcher WHERE task_id=:i AND user_id=:u"),
            {"i": task.id, "u": op},
        )
    ).scalar_one()
    assert w == 1
    # nenhum evento de history relacionado a watcher
    h = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type LIKE 'watch%'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert h == 0


async def test_watcher_terceiro_sem_assign_403(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    # usuario sem papel (sem task.assign), mas que VE a task por ter criado (avulsa)
    sem_perm = await f.make_user(db, workspace_id=ws)
    outro = await f.make_user(db, workspace_id=ws)
    avulsa = await f.make_task(db, workspace_id=ws, created_by=sem_perm, team_id=a, project_id=None)
    with acting_as(workspace_id=ws, user_id=sem_perm):  # roles vazios -> sem permissoes
        with pytest.raises(AuthorizationError):
            await CollaborationService(db).add_watcher(task_id=avulsa.id, user_id=outro)
