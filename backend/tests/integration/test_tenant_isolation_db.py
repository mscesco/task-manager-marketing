"""Isolamento de tenant + soft-delete no BaseRepository."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskFilters,
    TaskService,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _ws_admin(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    return ws, team, user


async def test_base_select_filtra_por_workspace(db) -> None:
    """Tasks do workspace A nao aparecem na listagem rodada como workspace B."""
    ws_a, team_a, user_a = await _ws_admin(db)
    proj_a = await f.make_project(db, workspace_id=ws_a, created_by=user_a, team_id=team_a)
    with acting_as(
        workspace_id=ws_a,
        user_id=user_a,
        memberships=(mship(team_a, "ADMIN"),),
        team_tree=(node(team_a),),
    ):
        await TaskService(db).create(
            CreateTaskCommand(title="A", project_id=proj_a, team_id=team_a)
        )

    ws_b, team_b, user_b = await _ws_admin(db)
    with acting_as(
        workspace_id=ws_b,
        user_id=user_b,
        memberships=(mship(team_b, "ADMIN"),),
        team_tree=(node(team_b),),
    ):
        page = await TaskService(db).list_page(PageParams(size=100), TaskFilters())
    assert page.total == 0


async def test_soft_deleted_excluido_por_padrao(db) -> None:
    """Apos soft_delete, a task some da listagem padrao."""
    ws, team, user = await _ws_admin(db)
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "ADMIN"),), team_tree=(node(team),)
    ):
        svc = TaskService(db)
        task = await svc.create(CreateTaskCommand(title="X", project_id=proj, team_id=team))
        await svc.soft_delete(task_id=task.id)
        page = await svc.list_page(PageParams(size=100), TaskFilters())
    assert all(t.id != task.id for t in page.items)


async def test_workspace_id_gravado_corresponde_ao_tenant(db) -> None:
    """Task criada herda o workspace_id do tenant corrente."""
    ws, team, user = await _ws_admin(db)
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    with acting_as(
        workspace_id=ws, user_id=user, memberships=(mship(team, "ADMIN"),), team_tree=(node(team),)
    ):
        task = await TaskService(db).create(
            CreateTaskCommand(title="X", project_id=proj, team_id=team)
        )
    row_ws = (
        await db.execute(text("SELECT workspace_id FROM task WHERE id=:i"), {"i": task.id})
    ).scalar_one()
    assert row_ws == ws
