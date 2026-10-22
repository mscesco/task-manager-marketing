"""Soft-delete cascateado + cascade_count + history (ADR 0005)."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import EntityNotFoundError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _admin_proj(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    # ADMIN de organizacao; o vinculo MANAGER fica so para ele poder ser
    # responsavel das tarefas que cria (designacao consulta `user_team`).
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="MANAGER"
    )
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    ctx = dict(
        workspace_id=ws, user_id=user, org_role="ADMIN", team_tree=(node(team),)
    )
    return ctx, proj, team


async def test_cascata_cascade_count_e_404(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(CreateTaskCommand(
            title="raiz",
            project_id=proj,
            team_id=team,
            assignee_ids=[ctx["user_id"]]),
        )
        f1 = await svc.create(
            CreateTaskCommand(
                title="f1",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        f2 = await svc.create(
            CreateTaskCommand(
                title="f2",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        neta = await svc.create(
            CreateTaskCommand(
                title="neta",
                project_id=proj,
                team_id=team,
                parent_task_id=f1.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        result = await svc.soft_delete(task_id=raiz.id)
        assert result.cascade_count == 3  # f1, f2, neta (sem contar a raiz)
        for t in (raiz, f1, f2, neta):
            with pytest.raises(EntityNotFoundError):
                await svc.get(t.id)


async def test_history_deleted_com_cascade_count(db) -> None:
    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(CreateTaskCommand(
            title="raiz",
            project_id=proj,
            team_id=team,
            assignee_ids=[ctx["user_id"]]),
        )
        await svc.create(
            CreateTaskCommand(
                title="f1",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        await svc.soft_delete(task_id=raiz.id)
    rows = (
        (
            await db.execute(
                text(
                    "SELECT metadata FROM task_history " "WHERE task_id=:i AND event_type='deleted'"
                ),
                {"i": raiz.id},
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0]["cascade_count"] == 1


async def test_apagar_PROJETO_deixa_as_tarefas_avulsas_e_abriveis(db) -> None:
    """⚠️ Auditoria de 21/10: apagar o projeto so marcava `project.deleted_at`.

    As tarefas continuavam nas listas (o join com projeto nao filtra apagado),
    mas abrir, editar ou arquivar dava 404 ate para o ADMIN: a guarda de
    visibilidade nao acha o projeto e trata como inconsistencia. A tela promete
    que elas "ficam no quadro sem projeto" -- e e isso que o teste prende.
    """
    from app.modules.tasks.application.project_service import ProjectService

    ctx, proj, team = await _admin_proj(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        mae = await svc.create(
            CreateTaskCommand(
                title="mae",
                project_id=proj,
                team_id=team,
                assignee_ids=[ctx["user_id"]],
            )
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=mae.id,
                assignee_ids=[ctx["user_id"]],
            )
        )
        await ProjectService(db).soft_delete(project_id=proj)
        await db.flush()

        for t in (mae, filha):
            aberta = await svc.get(t.id)
            assert aberta.project_id is None
