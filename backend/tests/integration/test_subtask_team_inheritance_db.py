"""Entrega 10 -- subtarefa herda o team_id do pai.

Garante que uma subtarefa criada sem team_id explicito NAO cai no subtime
default do criador, mas herda o time do pai (subtree coerente; esquiva a
divida #2 do fallback silencioso). E que team_id explicito vence a heranca.

Roda so com db-test de pe + TEST_DATABASE_URL setada (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _ctx_root_sub(db):
    """Workspace com raiz R e subtime S; usuario OPERATOR apenas de S.

    O default do criador resolve para S -- diferente de R de proposito, para
    distinguir HERANCA (pai em R) de DEFAULT (criador em S).
    """
    ws = await f.make_workspace(db)
    root = await f.make_team(db, workspace_id=ws, slug="marketing")
    sub = await f.make_team(
        db, workspace_id=ws, parent_team_id=root, slug="conteudo"
    )
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=sub, role="OPERATOR"
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(sub, "OPERATOR"),),
        team_tree=(node(root), node(sub, parent_team_id=root)),
    )
    return ctx, root, sub


async def test_subtarefa_herda_team_do_pai(db) -> None:
    ctx, root, sub = await _ctx_root_sub(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        # Pai avulso no time RAIZ (como o quadro faz via pin).
        pai = await svc.create(CreateTaskCommand(title="pai", team_id=root))
        assert pai.team_id == root
        # Subtarefa SEM team_id: herda o do pai (root); NAO cai no default
        # do criador (sub).
        filha = await svc.create(
            CreateTaskCommand(title="filha", parent_task_id=pai.id)
        )
        assert filha.team_id == root
        assert filha.team_id != sub


async def test_team_explicito_vence_heranca(db) -> None:
    ctx, root, sub = await _ctx_root_sub(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(CreateTaskCommand(title="pai", team_id=root))
        # team_id explicito na subtarefa tem precedencia sobre a heranca.
        filha = await svc.create(
            CreateTaskCommand(
                title="filha", parent_task_id=pai.id, team_id=sub
            )
        )
        assert filha.team_id == sub
