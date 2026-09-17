"""Spec 053, fatia A -- a TRAVA DOS AVISOS.

Nenhum aviso de tarefa vai para quem nao a alcanca no momento do envio (D19).
A trava mora no `NotificationEmitter`, e nao em cada service, para que um tipo
novo nao dependa de alguem lembrar.

O QUE ESTE ARQUIVO PRENDE:
  1. `user_ids_that_can_view_task` (lote) responde IGUAL a `user_can_view_task`
     (um por um) -- a regra nao pode existir duas vezes.
  2. Responsavel que perdeu o time nao recebe o aviso de comentario. Antes da
     trava recebia, com o titulo da tarefa no payload.
  3. ⚠️⚠️ O job de prazo continua avisando quem enxerga a tarefa POR
     HIERARQUIA. O job entra com `tenant_scope` SEM arvore de times; sem o
     `_arvore_de_times`, a trava calaria o aviso do gerente da raiz numa tarefa
     de subtime, sem erro nenhum.
  4. Desativado nao recebe.

SABOTAGENS (medidas):
  A. Em `task_guards._arvore_de_times`, devolver `tenant.team_tree` sempre (sem
     carregar do banco). Deve cair `test_job_de_prazo_avisa_quem_ve_por_hierarquia`.
  B. Em `NotificationEmitter.comment_on_task`, trocar
     `await self._so_quem_alcanca(task_id, alvos)` por `alvos`. Deve cair
     `test_responsavel_que_perdeu_o_time_nao_recebe_comentario`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select

from app.db.models import Notification
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from app.modules.tasks.application.task_guards import (
    user_can_view_task,
    user_ids_that_can_view_task,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
SOON = date(2026, 6, 27)


async def _mundo(db):
    """Raiz R com dois subtimes, A e B. A tarefa e do subtime A.

    - gerente: MANAGER da raiz -> enxerga A por HIERARQUIA (descendente).
    - op_a: OPERATOR de A -> enxerga.
    - op_b: OPERATOR de B -> NAO enxerga a tarefa de A.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    gerente = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=gerente, team_id=r, role="MANAGER")
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    task = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=a, title="Banner do A"
    )
    forest = (node(r), node(a, r), node(b, r))
    return ws, r, a, b, gerente, op_a, op_b, task, forest


async def _conta(db, *, recipient, tipo) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient_id == recipient, Notification.type == tipo)
        )
    ).scalar_one()


async def test_lote_responde_igual_ao_um_por_um(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, task, forest = await _mundo(db)
    inativo = await f.make_user(db, workspace_id=ws, is_active=False)
    await f.add_member(db, workspace_id=ws, user_id=inativo, team_id=a, role="OPERATOR")
    todos = [gerente, op_a, op_b, inativo]

    with acting_as(
        workspace_id=ws, user_id=gerente,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    ):
        lote = await user_ids_that_can_view_task(db, task=task, user_ids=todos)
        um_por_um = {
            u for u in todos if await user_can_view_task(db, task=task, user_id=u)
        }

    assert lote == um_por_um
    assert lote == {gerente, op_a}


async def test_responsavel_que_perdeu_o_time_nao_recebe_comentario(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, task, forest = await _mundo(db)
    # `op_b` ficou responsavel quando alcancava a tarefa e depois perdeu o time
    # (hoje, responsavel sem alcance continua responsavel -- spec 053 §8).
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=op_b, assigned_by=gerente
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=op_a, assigned_by=gerente
    )
    with acting_as(
        workspace_id=ws, user_id=gerente,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    ):
        await CommentService(db).create_comment(task_id=task.id, content="olha isso")
        await db.flush()

    assert await _conta(db, recipient=op_a, tipo="TASK_COMMENTED") == 1
    assert await _conta(db, recipient=op_b, tipo="TASK_COMMENTED") == 0


async def test_job_de_prazo_avisa_quem_ve_por_hierarquia(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, task, forest = await _mundo(db)
    task.due_date = SOON
    # O gerente da RAIZ e responsavel pela tarefa do subtime A: ele a enxerga
    # por ser MANAGER de um ancestral, e so a ARVORE diz isso.
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=gerente, assigned_by=gerente
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=op_b, assigned_by=gerente
    )
    await db.flush()

    # ⚠️ SEM `acting_as`: o job monta o proprio `tenant_scope`, sem arvore.
    await DeadlineNotifyService(db).run(now=NOW)

    assert await _conta(db, recipient=gerente, tipo="TASK_DUE_SOON") == 1
    # E a trava vale no job tambem: quem nao alcanca nao recebe.
    assert await _conta(db, recipient=op_b, tipo="TASK_DUE_SOON") == 0


async def test_desativado_nao_recebe(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, task, forest = await _mundo(db)
    inativo = await f.make_user(db, workspace_id=ws, is_active=False)
    await f.add_member(db, workspace_id=ws, user_id=inativo, team_id=a, role="OPERATOR")
    await f.make_assignment(
        db, workspace_id=ws, task_id=task.id, user_id=inativo, assigned_by=gerente
    )
    with acting_as(
        workspace_id=ws, user_id=gerente,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    ):
        await CommentService(db).create_comment(task_id=task.id, content="oi")
        await db.flush()

    assert await _conta(db, recipient=inativo, tipo="TASK_COMMENTED") == 0
