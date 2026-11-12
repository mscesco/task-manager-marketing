"""Toda tarefa nasce com responsavel, por qualquer cliente (nao so o modal).

  1. Criar sem responsavel e 422, em qualquer caminho.
  2. Remover o ULTIMO responsavel e 422: e a mesma porta, do outro lado.
  3. A regra nao retroage: tarefa antiga sem responsavel continua editavel.
     Validar o estado inteiro num PATCH parcial devolveria 422 por um campo
     que nem foi tocado.
  4. A duplicacao continua funcionando, resolvendo os responsaveis das filhas
     antes do create.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
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
        org_role="ADMIN",
        team_tree=(node(team),),
    )
    return ws, team, admin, ana, proj, ctx


async def test_criar_sem_responsavel_e_recusado(db) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        with pytest.raises(ValidationError) as e:
            await TaskService(db).create(
                CreateTaskCommand(title="Sem dono", project_id=proj, team_id=team)
            )
    assert "responsável" in str(e.value)


async def test_criar_SUBTAREFA_sem_responsavel_tambem_e_recusado(db) -> None:
    """A trava vale para subtarefa tambem, nao so para tarefa de topo."""
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
        with pytest.raises(ValidationError):
            await TaskService(db).create(
                CreateTaskCommand(
                    title="Sub sem dono",
                    project_id=proj,
                    team_id=team,
                    parent_task_id=pai.id,
                )
            )


async def test_remover_o_ULTIMO_responsavel_e_recusado(db) -> None:
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
        with pytest.raises(ValidationError):
            await CollaborationService(db).remove_assignee(
                task_id=t.id, user_id=ana
            )

    # ⚠️ Do BANCO: recusa tem de ser atomica, e o ORM devolveria o valor que
    # ele mesmo colocou em memoria.
    n = (
        await db.execute(
            text(
                "SELECT count(*) FROM task_assignment WHERE task_id = :t"
            ),
            {"t": t.id},
        )
    ).scalar_one()
    assert n == 1


async def test_remover_o_PENULTIMO_continua_funcionando(db) -> None:
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana, admin],
            )
        )
        await CollaborationService(db).remove_assignee(
            task_id=t.id, user_id=admin
        )
        restantes = await CollaborationService(db).assignee_ids_for(t)
    assert restantes == [ana]


async def test_a_regra_NAO_retroage_ao_editar_tarefa_antiga(db) -> None:
    """A regra nao vaza pro PATCH: tarefa sem responsavel (montada a mao)
    tem o TITULO editado sem 422."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Antiga",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
    # Por SQL: a tarefa perde o responsavel sem passar pelos guards.
    await db.execute(
        text("DELETE FROM task_assignment WHERE task_id = :t"), {"t": t.id}
    )
    await db.flush()

    with acting_as(**ctx):
        atualizada = await TaskService(db).update(
            task_id=t.id, command=UpdateTaskCommand(title="Antiga, renomeada")
        )
    assert atualizada.title == "Antiga, renomeada"


async def test_duplicar_continua_funcionando_com_a_trava(db) -> None:
    """O responsavel da copia (admin) difere do da filha (ana): a filha copiada
    mantem o dela, em vez de herdar o aplicado."""
    ws, team, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        origem = await svc.create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=team,
                assignee_ids=[ana],
            )
        )
        await svc.create(
            CreateTaskCommand(
                title="Roteiro",
                project_id=proj,
                team_id=team,
                parent_task_id=origem.id,
                assignee_ids=[ana],
            )
        )
        r = await svc.duplicate(
            DuplicateTaskCommand(
                source_id=origem.id,
                title="Cópia de Campanha",
                project_id=proj,
                team_id=team,
                assignee_ids=[admin],
                include_subtasks=True,
            )
        )
        from app.modules.tasks.infrastructure.task_repository import (
            TaskRepository,
        )

        filhas = await TaskRepository(db).list_children(
            parent_task_id=r.task.id
        )
        assert len(filhas) == 1
        assert await CollaborationService(db).assignee_ids_for(filhas[0]) == [
            ana
        ]
