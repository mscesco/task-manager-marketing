"""Visibilidade de tasks: a lente de time.

⚠️ O `created_by` NAO concede visibilidade: quem criou uma tarefa fora da
propria lente nao a ve. Continua sendo historico, mostrado a quem alcanca.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.task_service import TaskFilters, TaskService
from app.shared.exceptions.base import EntityNotFoundError
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


async def test_created_by_NAO_ve_avulsa_fora_da_lente(db) -> None:
    """Quem criou, com o time fora da lente, nao ve a tarefa.

    ⚠️ Afirma os dois caminhos: detalhe (`get`, em `task_guards.py`) e listagem
    (`list_page`, no `task_repository.py`). Um so deixaria a tarefa fora da
    lista e acessivel por link direto, ou o contrario.
    """
    ws, r, a, b = await _tree(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    # op cria (via factory) avulsa team=B (fora da lente dele {A,R})
    avulsa_b = await f.make_task(db, workspace_id=ws, created_by=op, team_id=b, project_id=None)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=_forest(r, a, b)
    ):
        svc = TaskService(db)
        # detalhe: 404, e nao 403 -- quem nao alcanca nao sabe que existe.
        with pytest.raises(EntityNotFoundError):
            await svc.get(avulsa_b.id)
        # listagem: nao aparece.
        page = await svc.list_page(PageParams(size=100), TaskFilters())
        assert not any(t.id == avulsa_b.id for t in page.items)


async def test_created_by_continua_na_resposta_de_quem_alcanca(db) -> None:
    """`created_by` nao concede acesso, mas continua sendo historico: a
    tarefa mostra quem a criou mesmo depois de essa pessoa perder a lente.
    Apagar o campo faria o teste acima passar e destruiria o dado.
    """
    ws, r, a, b = await _tree(db)
    op_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_b, team_id=b, role="OPERATOR")
    # criada por op_b, mas pinada no subtime A -- fora da lente DELE.
    avulsa_a = await f.make_task(
        db, workspace_id=ws, created_by=op_b, team_id=a, project_id=None
    )

    # quem ALCANCA o time A ve a tarefa e ve quem a criou.
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    with acting_as(
        workspace_id=ws, user_id=op_a, memberships=(mship(a, "OPERATOR"),),
        team_tree=_forest(r, a, b)
    ):
        t = await TaskService(db).get(avulsa_a.id)
        assert t.created_by == op_b


async def test_admin_ve_TUDO_sem_excecao(db) -> None:
    """O ADMIN ve todas as tarefas do workspace."""
    ws, r, a, b = await _tree(db)
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    outro = await f.make_user(db, workspace_id=ws)
    avulsa_b = await f.make_task(db, workspace_id=ws, created_by=outro, team_id=b, project_id=None)
    with acting_as(
        workspace_id=ws, user_id=admin, org_role="ADMIN", team_tree=_forest(r, a, b)
    ):
        assert (await TaskService(db).get(avulsa_b.id)).id == avulsa_b.id
