"""Entrega 10 -- a listagem (GET /tasks) traz assignee_ids em lote.

Garante que o selo do quadro tem de onde sair: cada item da pagina vem com
seus responsaveis, sem precisar de 1 chamada por card. Cobre task com 0, 1 e
N responsaveis na mesma pagina, e que o agrupamento nao vaza entre tasks.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _ctx(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    # Dois alvos pra designar -- MEMBROS do time da task, senao nao a
    # alcancam (o backend valida o alcance do designado -> 422).
    a = await f.make_user(db, workspace_id=ws, email="a@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=a, team_id=team, role="OPERATOR"
    )
    b = await f.make_user(db, workspace_id=ws, email="b@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=b, team_id=team, role="OPERATOR"
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ctx, team, a, b


async def test_lote_assignees_por_task(db) -> None:
    ctx, team, a, b = await _ctx(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        collab = CollaborationService(db)

        # ⚠️ t0 tem de terminar com ZERO responsaveis, e desde 05/08 nao da
        # pra CRIAR assim (ADR 0031). O estado continua existindo -- sao as
        # 37 tarefas legadas medidas em producao --, entao ele e montado como
        # elas: por SQL, por fora dos guards. Trocar isto por "t0 com
        # responsavel" mataria o objeto do teste, que e justamente a task
        # aparecer no mapa MESMO sem ninguem.
        t0 = await svc.create(
            CreateTaskCommand(
                title="sem ninguem", team_id=team, assignee_ids=[a]
            )
        )
        t1 = await svc.create(
            CreateTaskCommand(title="um", team_id=team, assignee_ids=[a])
        )
        tn = await svc.create(
            CreateTaskCommand(title="dois", team_id=team, assignee_ids=[a])
        )
        await db.execute(
            text("DELETE FROM task_assignment WHERE task_id = :t"),
            {"t": t0.id},
        )
        await db.flush()

        await collab.add_assignee(task_id=tn.id, user_id=b)

        amap = await collab.assignee_ids_for_tasks([t0, t1, tn])

        # Toda task pedida presente, mesmo sem responsavel.
        assert amap[t0.id] == []
        assert amap[t1.id] == [a]
        # N responsaveis; sem vazar entre tasks.
        assert set(amap[tn.id]) == {a, b}
        assert a not in amap[t0.id] and b not in amap[t1.id]


async def test_lote_vazio_nao_quebra(db) -> None:
    ctx, team, _a, _b = await _ctx(db)
    with acting_as(**ctx):
        collab = CollaborationService(db)
        assert await collab.assignee_ids_for_tasks([]) == {}
