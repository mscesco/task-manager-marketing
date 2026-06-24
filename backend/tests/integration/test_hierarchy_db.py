"""Hierarquia LTREE: create/move/ciclo."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    MoveTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _admin_proj(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    ctx = dict(
        workspace_id=ws, user_id=user, memberships=(mship(team, "ADMIN"),), team_tree=(node(team),)
    )
    return ctx, proj, team


async def test_create_raiz_e_filha_path_depth(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(CreateTaskCommand(title="raiz", project_id=proj, team_id=team))
        assert raiz.depth == 0 and raiz.path == f"t{raiz.id.hex}"
        filha = await svc.create(
            CreateTaskCommand(title="filha", project_id=proj, team_id=team, parent_task_id=raiz.id)
        )
        assert filha.depth == 1
        assert filha.path == f"{raiz.path}.t{filha.id.hex}"


async def test_move_reparent_reescreve_subtree(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        a = await svc.create(CreateTaskCommand(title="a", project_id=proj, team_id=team))
        b = await svc.create(CreateTaskCommand(title="b", project_id=proj, team_id=team))
        a_filha = await svc.create(
            CreateTaskCommand(title="af", project_id=proj, team_id=team, parent_task_id=a.id)
        )
        # move a (com a_filha) pra baixo de b
        await svc.move(task_id=a.id, command=MoveTaskCommand(parent_task_id=b.id))

    # move reescreve paths via UPDATE LTREE em massa; leio o estado final
    # direto do banco (evita lazy-load do ORM na mesma sessao).
    async def _dp(tid):
        row = (
            await db.execute(text("SELECT depth, path::text FROM task WHERE id=:i"), {"i": tid})
        ).one()
        return row[0], row[1]

    a_depth, a_path = await _dp(a.id)
    af_depth, af_path = await _dp(a_filha.id)
    _, b_path = await _dp(b.id)
    assert a_depth == 1 and a_path.startswith(b_path + ".")
    assert af_depth == 2 and af_path.startswith(a_path + ".")


async def test_move_ciclo_e_auto_pai_409(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(CreateTaskCommand(title="raiz", project_id=proj, team_id=team))
        filha = await svc.create(
            CreateTaskCommand(title="filha", project_id=proj, team_id=team, parent_task_id=raiz.id)
        )
        with pytest.raises(BusinessRuleError):  # auto-pai
            await svc.move(task_id=raiz.id, command=MoveTaskCommand(parent_task_id=raiz.id))
        with pytest.raises(BusinessRuleError):  # ciclo (pai vira filho do proprio filho)
            await svc.move(task_id=raiz.id, command=MoveTaskCommand(parent_task_id=filha.id))
