"""Desarquivar subtarefa cujo PAI esta arquivado e recusado.

Desarquivada sob um pai arquivado, ela sairia de /arquivadas e nao apareceria
em lugar nenhum: o quadro so desenha tarefa de topo, e a checklist dela e a de
um pai que ninguem abre. A duplicacao tem a mesma porta para "subtarefa ATIVA
sob pai ARQUIVADO" (`test_task_duplicate_db.py`).
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    # ADMIN de organizacao; o vinculo MANAGER fica so para ele poder ser
    # responsavel das tarefas que cria (designacao consulta `user_team`).
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="MANAGER"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(team),),
    )
    return ws, team, user, proj, ctx


async def _arvore(db, ctx, proj, team, user):
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(
            CreateTaskCommand(
                title="Campanha de março", project_id=proj, team_id=team,
                assignee_ids=[user],
            )
        )
        sub = await svc.create(
            CreateTaskCommand(
                title="sub",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
                assignee_ids=[user],
            )
        )
    return pai, sub


async def test_desarquivar_sub_com_pai_arquivado_e_recusado(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team, user)
    # ⚠️ Arquiva pelo ORM, nao por UPDATE cru: SQL direto nao avisa a sessao e
    # o service leria o objeto CACHEADO com is_archived=False.
    pai.is_archived = True
    sub.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        with pytest.raises(ValidationError) as e:
            await TaskService(db).unarchive(task_id=sub.id)

    # A mensagem nomeia o pai: /arquivadas nao mostra hierarquia.
    assert "Campanha de março" in str(e.value)
    # E a recusa e atomica: a sub continua arquivada.
    await db.refresh(sub)
    assert sub.is_archived is True


async def test_pai_ATIVO_desarquiva_normalmente(db) -> None:
    """O outro lado: com o pai vivo a subtarefa volta pra checklist dele, que
    e alcancavel. Recusar aqui seria travar o caso comum."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team, user)
    sub.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=sub.id)

    # unarchive devolve ArchiveResult (task + cascade_count).
    assert r.task.is_archived is False
    assert r.cascade_count == 0  # folha: nao ha subarvore
    assert pai.is_archived is False


async def test_tarefa_de_TOPO_desarquiva_normalmente(db) -> None:
    """Sem pai nao ha o que checar -- e a tarefa volta direto pro quadro."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        raiz = await TaskService(db).create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team, assignee_ids=[user])
        )
    raiz.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=raiz.id)
    assert r.task.is_archived is False


async def test_idempotencia_preservada(db) -> None:
    """Desarquivar quem ja esta ativo continua no-op -- inclusive com pai
    arquivado. A trava so vale pra quem ESTA arquivada; sem esta condicao,
    um clique repetido viraria erro."""
    ws, team, user, proj, ctx = await _mundo(db)
    pai, sub = await _arvore(db, ctx, proj, team, user)
    pai.is_archived = True
    await db.flush()

    with acting_as(**ctx):
        r = await TaskService(db).unarchive(task_id=sub.id)
    assert r.task.is_archived is False
