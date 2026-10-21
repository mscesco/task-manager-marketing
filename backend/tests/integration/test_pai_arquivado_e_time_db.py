"""Auditoria de 21/10 -- duas portas que o `TaskService` deixava abertas.

1. Criar ou mover subtarefa PARA um pai arquivado. Duplicar, arquivar e
   desarquivar ja recusavam o estado "filha ativa sob pai arquivado"; criar e
   mover nao -- e a filha nascia sem tela nenhuma que a mostrasse.
2. Trocar o `team_id` de uma tarefa com subtarefas vivas: o PATCH escrevia so
   na mae, e as filhas ficavam no time antigo.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    MoveTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="sub")
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await f.add_member(db, workspace_id=ws, user_id=user, team_id=raiz, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=raiz)
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(raiz), node(sub, parent_team_id=raiz)),
    )
    return raiz, sub, proj, ctx, user


async def test_criar_subtarefa_sob_pai_ARQUIVADO_e_recusado(db) -> None:
    raiz, _sub, proj, ctx, user = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(CreateTaskCommand(title="pai", project_id=proj, team_id=raiz, assignee_ids=[user]))
        await svc.archive(task_id=pai.id)
        with pytest.raises(ValidationError):
            await svc.create(
                CreateTaskCommand(
                    title="filha", project_id=proj, team_id=raiz, parent_task_id=pai.id, assignee_ids=[user]
                )
            )


async def test_mover_para_pai_ARQUIVADO_e_recusado(db) -> None:
    raiz, _sub, proj, ctx, user = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(CreateTaskCommand(title="pai", project_id=proj, team_id=raiz, assignee_ids=[user]))
        solta = await svc.create(CreateTaskCommand(title="solta", project_id=proj, team_id=raiz, assignee_ids=[user]))
        await svc.archive(task_id=pai.id)
        with pytest.raises(ValidationError):
            await svc.move(task_id=solta.id, command=MoveTaskCommand(parent_task_id=pai.id))


async def test_trocar_time_com_subtarefa_viva_e_recusado(db) -> None:
    raiz, sub, proj, ctx, user = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(CreateTaskCommand(title="pai", project_id=proj, team_id=raiz, assignee_ids=[user]))
        await svc.create(
            CreateTaskCommand(title="filha", project_id=proj, team_id=raiz, parent_task_id=pai.id, assignee_ids=[user])
        )
        with pytest.raises(ValidationError):
            await svc.update(task_id=pai.id, command=UpdateTaskCommand(team_id=sub))
        # Sem filha viva, a troca segue valendo.
        sozinha = await svc.create(
            CreateTaskCommand(title="sozinha", project_id=proj, team_id=raiz, assignee_ids=[user])
        )
        movida = await svc.update(task_id=sozinha.id, command=UpdateTaskCommand(team_id=sub))
        assert movida.team_id == sub
