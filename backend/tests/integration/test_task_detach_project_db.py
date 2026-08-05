"""Spec 022 -- move aceita tirar task de projeto (avulsa).

Cobre os 7 criterios de aceite: mover entre projetos (regressao), detach de
topo (task + subtree -> project_id NULL), detach idempotente em avulsa, e os
tres 422 (subtarefa, detach+projeto, detach+pai).

Le o project_id final direto do banco: o move reescreve via UPDATE LTREE em
massa e o ORM na mesma sessao pode ficar stale (mesmo padrao do
test_hierarchy_db).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    MoveTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _ctx_dois_projetos(db):
    """ws + team + admin + projeto A e projeto B (mesmo time)."""
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN")
    proj_a = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team, title="A"
    )
    proj_b = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team, title="B"
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ctx, proj_a, proj_b, team


async def _project_id(db, tid):
    row = (
        await db.execute(
            text("SELECT project_id FROM task WHERE id = :i"), {"i": tid}
        )
    ).one()
    return row[0]


# 1 -- mover entre projetos leva task + subtree (regressao, comportamento antigo).
async def test_move_entre_projetos_leva_subtree(db) -> None:
    ctx, proj_a, proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha", project_id=proj_a, team_id=team, parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        await svc.move(task_id=raiz.id, command=MoveTaskCommand(project_id=proj_b))

    assert await _project_id(db, raiz.id) == proj_b
    assert await _project_id(db, filha.id) == proj_b  # subtree acompanha


# 2 -- detach de topo: task e subtree viram avulsa (project_id NULL).
async def test_detach_torna_avulsa_com_subtree(db) -> None:
    ctx, proj_a, _proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha", project_id=proj_a, team_id=team, parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        await svc.move(task_id=raiz.id, command=MoveTaskCommand(detach_project=True))

    assert await _project_id(db, raiz.id) is None
    assert await _project_id(db, filha.id) is None  # subtree acompanha


# 3 -- detach numa task ja avulsa: no-op, sem erro.
async def test_detach_avulsa_e_noop(db) -> None:
    ctx, _proj_a, _proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        avulsa = await svc.create(
            CreateTaskCommand(
                title="avulsa",
                project_id=None,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        # nao deve lancar
        await svc.move(task_id=avulsa.id, command=MoveTaskCommand(detach_project=True))

    assert await _project_id(db, avulsa.id) is None


# 4 -- detach numa subtarefa (tem pai) -> 422.
async def test_detach_subtarefa_422(db) -> None:
    ctx, proj_a, _proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha", project_id=proj_a, team_id=team, parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        with pytest.raises(ValidationError):
            await svc.move(
                task_id=filha.id, command=MoveTaskCommand(detach_project=True)
            )


# 5 -- detach + project_id preenchido -> 422 (contraditorio).
async def test_detach_com_projeto_422(db) -> None:
    ctx, proj_a, proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        with pytest.raises(ValidationError):
            await svc.move(
                task_id=raiz.id,
                command=MoveTaskCommand(detach_project=True, project_id=proj_b),
            )


# 6 -- detach + parent_task_id preenchido -> 422 (avulsa nao tem pai).
async def test_detach_com_pai_422(db) -> None:
    ctx, proj_a, _proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        outra = await svc.create(
            CreateTaskCommand(
                title="outra",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        with pytest.raises(ValidationError):
            await svc.move(
                task_id=outra.id,
                command=MoveTaskCommand(detach_project=True, parent_task_id=raiz.id),
            )


# 7 -- sem detach e sem projeto/pai: no-op, task fica onde estava.
async def test_move_vazio_e_noop(db) -> None:
    ctx, proj_a, _proj_b, team = await _ctx_dois_projetos(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj_a,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        await svc.move(task_id=raiz.id, command=MoveTaskCommand())

    assert await _project_id(db, raiz.id) == proj_a
