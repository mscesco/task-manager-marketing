"""Visibilidade de tasks: pessoal, lente de time, created_by (ADR 0013)."""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import (
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import AuthorizationError, EntityNotFoundError
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _tree(db):
    """Workspace com raiz R e dois subtimes A e B (irmaos)."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    return ws, r, a, b


def _forest(r, a, b):
    return (node(r), node(a, r), node(b, r))


async def test_pessoal_dono_ve_outro_404(db) -> None:
    ws, r, a, b = await _tree(db)
    dono = await f.make_user(db, workspace_id=ws)
    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=outro, team_id=a, role="OPERATOR")
    pessoal = await f.make_project(
        db, workspace_id=ws, created_by=dono, team_id=None, is_personal=True
    )
    task = await f.make_task(db, workspace_id=ws, created_by=dono, team_id=None, project_id=pessoal)
    # dono ve
    with acting_as(workspace_id=ws, user_id=dono):
        assert (await TaskService(db).get(task.id)).id == task.id
    # outro nao ve -> 404
    with acting_as(
        workspace_id=ws,
        user_id=outro,
        memberships=(mship(a, "OPERATOR"),),
        team_tree=_forest(r, a, b),
    ):
        with pytest.raises(EntityNotFoundError):
            await TaskService(db).get(task.id)


async def test_projeto_comum_visivel_por_time_do_projeto(db) -> None:
    ws, r, a, b = await _tree(db)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    # task do projeto com team do subtime irmao B (dentro do projeto de team A)
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=b, project_id=proj)
    # manager de R ve o projeto (team A na lente) -> ve a task mesmo sendo team B
    with acting_as(
        workspace_id=ws,
        user_id=manager,
        memberships=(mship(r, "MANAGER"),),
        team_tree=_forest(r, a, b),
    ):
        assert (await TaskService(db).get(task.id)).id == task.id


async def test_avulsa_lente_de_time(db) -> None:
    ws, r, a, b = await _tree(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    criador = await f.make_user(db, workspace_id=ws)
    avulsa_a = await f.make_task(
        db, workspace_id=ws, created_by=criador, team_id=a, project_id=None
    )
    avulsa_b = await f.make_task(
        db, workspace_id=ws, created_by=criador, team_id=b, project_id=None
    )
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        svc = TaskService(db)
        assert (await svc.get(avulsa_a.id)).id == avulsa_a.id  # team A na lente
        with pytest.raises(EntityNotFoundError):
            await svc.get(avulsa_b.id)  # team B (irmao) fora da lente


async def test_created_by_ve_avulsa_fora_da_lente_mas_nao_edita(db) -> None:
    ws, r, a, b = await _tree(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    # op cria (via factory) avulsa team=B (fora da lente dele {A,R})
    avulsa_b = await f.make_task(db, workspace_id=ws, created_by=op, team_id=b, project_id=None)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        svc = TaskService(db)
        # VE (created_by) ...
        assert (await svc.get(avulsa_b.id)).id == avulsa_b.id
        page = await svc.list_page(PageParams(size=100), TaskFilters())
        assert any(t.id == avulsa_b.id for t in page.items)
        # ... mas NAO edita (team B fora da lente de edicao) -> 403
        with pytest.raises(AuthorizationError):
            await svc.update(task_id=avulsa_b.id, command=UpdateTaskCommand(title="x"))


async def test_admin_ve_tudo_menos_pessoal_alheio(db) -> None:
    ws, r, a, b = await _tree(db)
    admin = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=admin, team_id=r, role="ADMIN")
    outro = await f.make_user(db, workspace_id=ws)
    avulsa_b = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=b, project_id=None)
    pessoal_outro = await f.make_project(
        db, workspace_id=ws, created_by=outro, team_id=None, is_personal=True
    )
    task_pessoal = await f.make_task(
        db, workspace_id=ws, created_by=outro, team_id=None, project_id=pessoal_outro
    )
    with acting_as(
        workspace_id=ws, user_id=admin, memberships=(mship(r, "ADMIN"),), team_tree=_forest(r, a, b)
    ):
        svc = TaskService(db)
        assert (await svc.get(avulsa_b.id)).id == avulsa_b.id  # admin ve tudo
        with pytest.raises(EntityNotFoundError):
            await svc.get(task_pessoal.id)  # menos pessoal alheio
