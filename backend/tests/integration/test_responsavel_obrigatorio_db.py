"""Toda tarefa nasce com responsavel (ADR 0031, fatia 3).

A regra vivia SO no modal (`criacaoTarefa.motivoNaoCria`): valia pra quem
usava a tela e nao valia pro n8n, pro Swagger nem pra duplicacao. Aqui ela
passa a valer pra todo cliente.

O que estes testes defendem, em ordem:

  1. Criar sem responsavel e 422 -- em qualquer caminho.
  2. Remover o ULTIMO responsavel e 422. Travar so a criacao nao fecha nada:
     e a mesma porta, do outro lado.
  3. A regra NAO retroage. As 37 tarefas vivas sem responsavel medidas em
     05/08 continuam editaveis -- validar estado inteiro num PATCH parcial e a
     forma exata do defeito de 04/08 (editar o titulo devolvendo 422 por causa
     de um campo que nem foi tocado).
  4. A duplicacao continua funcionando, agora resolvendo os responsaveis das
     filhas ANTES do create.
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
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws)
    ana = await f.make_user(db, workspace_id=ws)
    for u in (admin, ana):
        await f.add_member(
            db,
            workspace_id=ws,
            user_id=u,
            team_id=team,
            role="ADMIN" if u == admin else "OPERATOR",
        )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=admin, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(team, "ADMIN"),),
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
    """44 das 50 tarefas ativas sem responsavel eram SUBTAREFAS (29/07). Se a
    trava valesse so pra raiz, ela nao pegaria o caso que criou o passivo."""
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
    """⚠️ O teste que impede a regra de vazar pro PATCH.

    Monta o passivo a mao (como as 37 de producao) e edita o TITULO. Se isso
    devolver 422, ninguem consegue mais mexer nas tarefas antigas -- que e o
    defeito de 04/08 repetido, agora em escala maior.
    """
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
    # Passivo montado por SQL: a tarefa perde o responsavel sem passar pelos
    # guards, exatamente como as linhas que ja existem em producao.
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
