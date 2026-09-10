"""Assignment + Watchers no banco: 404/409/422 + idempotencia + history."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.modules.tasks.application.collaboration_service import CollaborationService
from app.modules.tasks.application.task_service import (
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _world(db):
    """WS com raiz R + subtimes A e B; manager de R; projeto comum team A."""
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=r, role="MANAGER")
    proj = await f.make_project(db, workspace_id=ws, created_by=manager, team_id=a)
    forest = (node(r), node(a, r), node(b, r))
    mgr_ctx = dict(
        workspace_id=ws, user_id=manager, memberships=(mship(r, "MANAGER"),), team_tree=forest
    )
    return ws, r, a, b, manager, proj, forest, mgr_ctx


async def _count_assign(db, task_id):
    return (
        await db.execute(
            text("SELECT count(*) FROM task_assignment WHERE task_id=:i"), {"i": task_id}
        )
    ).scalar_one()


async def test_add_assignee_cria_linha_e_history(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        _, created = await CollaborationService(db).add_assignee(task_id=task.id, user_id=alvo)
    assert created is True
    assert await _count_assign(db, task.id) == 1
    hist = (
        (
            await db.execute(
                text(
                    "SELECT metadata FROM task_history WHERE task_id=:i AND event_type='assigned'"
                ),
                {"i": task.id},
            )
        )
        .scalars()
        .all()
    )
    assert len(hist) == 1
    assert hist[0]["user_id"] == str(alvo)
    assert hist[0]["assigned_by"] == str(manager)


async def test_add_assignee_idempotente(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        svc = CollaborationService(db)
        await svc.add_assignee(task_id=task.id, user_id=alvo)
        _, created2 = await svc.add_assignee(task_id=task.id, user_id=alvo)
    assert created2 is False
    assert await _count_assign(db, task.id) == 1
    hist = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type='assigned'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert hist == 1  # no-op nao gera 2a linha


async def test_remove_assignee_history_e_404(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    alvo = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        svc = CollaborationService(db)
        # ⚠️ AJUSTADO EM 05/08 (ADR 0031). Antes o teste designava UMA pessoa e
        # a removia, ficando com zero -- que e exatamente o estado que a ADR
        # fecha. Agora ha DOIS responsaveis: remover um continua funcionando
        # (e e o que este teste mede), remover o ultimo e outro teste, em
        # test_responsavel_obrigatorio_db.py.
        await svc.add_assignee(task_id=task.id, user_id=manager)
        await svc.add_assignee(task_id=task.id, user_id=alvo)
        await svc.remove_assignee(task_id=task.id, user_id=alvo)
        assert await _count_assign(db, task.id) == 1
        with pytest.raises(EntityNotFoundError):
            await svc.remove_assignee(task_id=task.id, user_id=alvo)
    un = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type='unassigned'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert un == 1


async def test_assignee_fora_de_alcance_422(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    # alvo so do subtime B -> lente {B,R}; task do projeto team A -> nao alcanca
    alvo_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo_b, team_id=b, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(**mgr_ctx):
        with pytest.raises(ValidationError):
            await CollaborationService(db).add_assignee(task_id=task.id, user_id=alvo_b)


async def test_operator_designa_no_quadro_geral(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    colega = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=colega, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=op, team_id=a, project_id=proj)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        _, created = await CollaborationService(db).add_assignee(task_id=task.id, user_id=colega)
    assert created is True


async def test_assignment_nao_concede_edicao(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    # task do projeto (team A) mas com team B; opA ve (projeto) mas nao edita (team B)
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=b, project_id=proj)
    with acting_as(**mgr_ctx):
        await CollaborationService(db).add_assignee(task_id=task.id, user_id=op_a)
    # op_a agora e responsavel, mas continua sem poder editar (team B fora da lente dele)
    with acting_as(
        workspace_id=ws, user_id=op_a, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        with pytest.raises(AuthorizationError):
            await TaskService(db).update(task_id=task.id, command=UpdateTaskCommand(title="x"))


async def test_watcher_self_sem_permissao_sem_history(db) -> None:
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=a, role="OPERATOR")
    task = await f.make_task(db, workspace_id=ws, created_by=manager, team_id=a, project_id=proj)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(a, "OPERATOR"),), team_tree=forest
    ):
        _, created = await CollaborationService(db).add_watcher(task_id=task.id, user_id=None)
    assert created is True
    w = (
        await db.execute(
            text("SELECT count(*) FROM task_watcher WHERE task_id=:i AND user_id=:u"),
            {"i": task.id, "u": op},
        )
    ).scalar_one()
    assert w == 1
    # nenhum evento de history relacionado a watcher
    h = (
        await db.execute(
            text("SELECT count(*) FROM task_history WHERE task_id=:i AND event_type LIKE 'watch%'"),
            {"i": task.id},
        )
    ).scalar_one()
    assert h == 0


async def test_watcher_terceiro_fora_do_escopo_de_edicao_403(db) -> None:
    """ADR 0011: inscrever TERCEIRO exige `task.assign` + escopo de EDICAO.

    ⚠️ ESTE TESTE FOI RECONSTRUIDO NA SPEC 037 (F5), e a reconstrucao registra
    uma perda de cobertura que nao da para desfazer.

    A versao anterior usava um ator SEM VINCULO NENHUM (`acting_as` com roles
    vazios) que enxergava a task por ter criado (o ramo `created_by` da ADR
    0013). Ela afirmava a metade da PERMISSAO da regra: ve, mas nao tem
    `task.assign` -> 403.

    ⚠️ ESSA METADE FICOU SEM CAMINHO. Depois da E1, enxergar exige vinculo de
    time, e os QUATRO papeis carregam `task.assign`
    (`permissions.py:65, 78, 86, 100`). Nao existe mais alguem que enxergue uma
    task e nao tenha a permissao -- o `require_permission` daquele ramo nao e
    alcancavel pela lente. NAO gaste sessao tentando construir o cenario: ele
    exigiria um papel novo sem `task.assign`, que e decisao de produto.

    O que continua alcancavel e a metade do ESCOPO DE EDICAO, e este teste
    passa a afirma-la pelo unico caminho que existe: task dentro de PROJETO
    COMUM. `task_visible` olha `project.team_id`; `task_editable` olha
    `task.team_id`. Projeto no time A (na lente), task pinada no time B (fora)
    -> ve pelo projeto, nao edita pela task.
    """
    ws, r, a, b, manager, proj, forest, mgr_ctx = await _world(db)
    op_a = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op_a, team_id=a, role="OPERATOR")
    outro = await f.make_user(db, workspace_id=ws)
    # projeto comum do time A (proj), task pinada no time B.
    task_b = await f.make_task(
        db, workspace_id=ws, created_by=manager, team_id=b, project_id=proj
    )

    with acting_as(
        workspace_id=ws, user_id=op_a, memberships=(mship(a, "OPERATOR"),),
        team_tree=forest,
    ):
        svc = CollaborationService(db)
        # ENXERGA (pelo time do projeto) -- e isto e o que separa 403 de 404.
        await svc.list_watchers(task_id=task_b.id)
        # ...mas inscrever TERCEIRO exige editar, e o time B nao e dela.
        with pytest.raises(AuthorizationError):
            await svc.add_watcher(task_id=task_b.id, user_id=outro)
