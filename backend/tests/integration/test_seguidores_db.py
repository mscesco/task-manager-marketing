"""Seguir uma tarefa: o backend.

A tela diz "seguir"; o codigo e o banco continuam dizendo `watcher`.

  - por/tirar OUTRA pessoa grava historico e avisa quem foi posto/tirado;
    seguir a si mesmo grava historico e NAO avisa;
  - tarefa arquivada: seguidores so leitura, 422 `tarefa_arquivada`;
  - a permissao de por terceiro e perguntada NO TIME DA TAREFA;
  - criar com `watcher_ids` pelo HTTP (a linha do router) e o 422 atomico;
  - trocar o time (PATCH) ou o projeto (move) tira quem deixou de alcancar,
    com `lost_access` no historico e SEM aviso.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

from app.core.tenant import Membership, TenantContext
from app.db.models import Notification, TaskWatcher
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    MoveTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, cliente, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz R com subtimes A e B. Gerente da raiz; um operador em cada subtime."""
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
    forest = (node(r), node(a, r), node(b, r))
    return ws, r, a, b, gerente, op_a, op_b, forest


def _como_gerente(ws, r, gerente, forest):
    return acting_as(
        workspace_id=ws, user_id=gerente,
        memberships=(mship(r, "MANAGER"),), team_tree=forest,
    )


def _como_op(ws, time, user, forest):
    return acting_as(
        workspace_id=ws, user_id=user,
        memberships=(mship(time, "OPERATOR"),), team_tree=forest,
    )


async def _historico(db, task_id, tipo):
    return (
        await db.execute(
            text(
                "SELECT metadata FROM task_history "
                "WHERE task_id=:t AND event_type=:e ORDER BY created_at"
            ),
            {"t": task_id, "e": tipo},
        )
    ).scalars().all()


async def _avisos(db, recipient, tipo):
    return (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient_id == recipient, Notification.type == tipo)
        )
    ).scalar_one()


async def _seguidores(db, task_id):
    return set(
        (
            await db.execute(
                select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)
            )
        ).scalars().all()
    )


# ----------------------------------------------------------
# por / tirar / seguir a si mesmo
# ----------------------------------------------------------
async def test_por_e_tirar_outra_pessoa_grava_historico_e_avisa(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)

    with _como_gerente(ws, r, gerente, forest):
        svc = CollaborationService(db)
        _, criou = await svc.add_watcher(task_id=task.id, user_id=op_a)
        await svc.remove_watcher(task_id=task.id, user_id=op_a)
        await db.flush()

    assert criou is True
    assert await _historico(db, task.id, "watched") == [
        {"target_user_id": str(op_a), "by_self": False, "reason": "manual"}
    ]
    assert await _historico(db, task.id, "unwatched") == [
        {"target_user_id": str(op_a), "by_self": False, "reason": "manual"}
    ]
    # ⚠️ Pos e tirou dentro da janela de 10 minutos, sem ninguem ler: os dois
    # avisos se ANULAM. Cada um sozinho avisa -- ver
    # `test_por_outra_pessoa_avisa_quem_foi_posto`.
    assert await _avisos(db, op_a, "TASK_WATCH_ADDED") == 0
    assert await _avisos(db, op_a, "TASK_WATCH_REMOVED") == 0


async def test_por_outra_pessoa_avisa_quem_foi_posto(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)

    with _como_gerente(ws, r, gerente, forest):
        await CollaborationService(db).add_watcher(task_id=task.id, user_id=op_a)
        await db.flush()

    assert await _avisos(db, op_a, "TASK_WATCH_ADDED") == 1


async def test_seguir_a_si_mesmo_nao_avisa(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)

    with _como_op(ws, a, op_a, forest):
        svc = CollaborationService(db)
        await svc.add_watcher(task_id=task.id, user_id=None)
        await svc.remove_watcher(task_id=task.id, user_id=op_a)
        await db.flush()

    assert await _avisos(db, op_a, "TASK_WATCH_ADDED") == 0
    assert await _avisos(db, op_a, "TASK_WATCH_REMOVED") == 0
    assert await _historico(db, task.id, "unwatched") == [
        {"target_user_id": str(op_a), "by_self": True, "reason": "manual"}
    ]


async def test_seguir_de_novo_nao_duplica_historico(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)

    with _como_op(ws, a, op_a, forest):
        svc = CollaborationService(db)
        await svc.add_watcher(task_id=task.id, user_id=None)
        _, criou = await svc.add_watcher(task_id=task.id, user_id=None)
        await db.flush()

    assert criou is False
    assert len(await _historico(db, task.id, "watched")) == 1


# ----------------------------------------------------------
# arquivada e permissao
# ----------------------------------------------------------
async def test_arquivada_recusa_seguir_e_deixar_de_seguir(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)
    await f.make_watcher(db, workspace_id=ws, task_id=task.id, user_id=op_a)
    task.is_archived = True
    await db.flush()

    with _como_op(ws, a, op_a, forest):
        svc = CollaborationService(db)
        with pytest.raises(ValidationError) as seguir:
            await svc.add_watcher(task_id=task.id, user_id=None)
        with pytest.raises(ValidationError) as sair:
            await svc.remove_watcher(task_id=task.id, user_id=op_a)

    assert seguir.value.code == "tarefa_arquivada"
    assert sair.value.code == "tarefa_arquivada"
    assert await _seguidores(db, task.id) == {op_a}


async def test_por_terceiro_exige_permissao_no_time_da_tarefa(db) -> None:
    """Quem ENXERGA a tarefa sem ter `task.assign` no time DELA recebe 403.

    ⚠️ O UNICO CENARIO QUE EXISTE, e vale saber por que: o escopo das
    permissoes (`permissions_for_actor`) espelha o da visibilidade -- execucao
    tem o proprio time + a raiz, comando tem o time + descendentes. Entao nao
    ha quem veja um TIME sem ter a permissao nele. O que separa as duas coisas
    e o PROJETO: `task_visible` olha `project.team_id`, e a permissao e
    perguntada no `task.team_id`. Projeto de A, tarefa de B -> o
    operador de A ve pelo projeto e nao tem `task.assign` em B.

    O `required_permission` nos detalhes prova que barrou a permissao, e nao a
    edicao.
    """
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    proj_a = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=a)
    task_b = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=b, project_id=proj_a
    )

    with _como_op(ws, a, op_a, forest):
        svc = CollaborationService(db)
        # Seguir a si mesmo continua exigindo so ver.
        await svc.add_watcher(task_id=task_b.id, user_id=None)
        with pytest.raises(AuthorizationError) as erro:
            await svc.add_watcher(task_id=task_b.id, user_id=gerente)

    assert erro.value.details.get("required_permission") == "task.assign"


# ----------------------------------------------------------
# criacao com seguidores, pelo HTTP
# ----------------------------------------------------------
def _ctx_gerente(ws, r, gerente, forest) -> TenantContext:
    return TenantContext(
        workspace_id=ws,
        user_id=gerente,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_roles(frozenset({"MANAGER"})),
        memberships=(Membership(team_id=r, role="MANAGER"),),
        team_tree=forest,
    )


async def test_http_cria_com_seguidor(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    await db.commit()
    async with cliente(db, _ctx_gerente(ws, r, gerente, forest)) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Nasce com seguidor",
                "team_id": str(a),
                "assignee_ids": [str(gerente)],
                "watcher_ids": [str(op_a)],
            },
        )
        assert resp.status_code == 201, resp.text
        detalhe = await c.get(f"/api/v1/tasks/{resp.json()['id']}")

    assert detalhe.json()["watcher_ids"] == [str(op_a)]
    task_id = resp.json()["id"]
    assert await _historico(db, task_id, "watched") == [
        {"target_user_id": str(op_a), "by_self": False, "reason": "created_with"}
    ]
    assert await _avisos(db, op_a, "TASK_WATCH_ADDED") == 1


async def test_http_seguidor_sem_alcance_recusa_a_criacao_inteira(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    await db.commit()
    antes = (
        await db.execute(text("SELECT count(*) FROM task WHERE workspace_id=:w"), {"w": ws})
    ).scalar_one()
    async with cliente(db, _ctx_gerente(ws, r, gerente, forest)) as c:
        resp = await c.post(
            "/api/v1/tasks",
            json={
                "title": "Nao nasce",
                "team_id": str(a),
                "assignee_ids": [str(gerente)],
                # `op_b` e de B: nao alcanca a tarefa de A.
                "watcher_ids": [str(op_a), str(op_b)],
            },
        )

    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["details"]["invalid_ids"] == [str(op_b)]
    depois = (
        await db.execute(text("SELECT count(*) FROM task WHERE workspace_id=:w"), {"w": ws})
    ).scalar_one()
    assert depois == antes


# ----------------------------------------------------------
# saida automatica
# ----------------------------------------------------------
async def test_trocar_time_tira_quem_perdeu_alcance_sem_avisar(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    task = await f.make_task(db, workspace_id=ws, created_by=gerente, team_id=a)
    await f.make_watcher(db, workspace_id=ws, task_id=task.id, user_id=op_a)
    await f.make_watcher(db, workspace_id=ws, task_id=task.id, user_id=gerente)

    with _como_gerente(ws, r, gerente, forest):
        await TaskService(db).update(
            task_id=task.id, command=UpdateTaskCommand(team_id=b)
        )
        await db.flush()

    # `op_a` so enxerga A; o gerente da raiz continua enxergando B.
    assert await _seguidores(db, task.id) == {gerente}
    assert await _historico(db, task.id, "unwatched") == [
        {"target_user_id": str(op_a), "by_self": False, "reason": "lost_access"}
    ]
    assert await _avisos(db, op_a, "TASK_WATCH_REMOVED") == 0


async def test_trocar_projeto_tira_seguidor_da_subarvore(db) -> None:
    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    # Do projeto da raiz para o do subtime A (mover do A para projeto do B e
    # recusado). O projeto decide quem ve: no da raiz o operador do B via a
    # tarefa, no do A deixa de ver, e sai de seguidor.
    proj_r = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=r)
    proj_a = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=a)
    mae = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=a, project_id=proj_r
    )
    filha = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=a, project_id=proj_r,
        parent=mae,
    )
    await f.make_watcher(db, workspace_id=ws, task_id=filha.id, user_id=op_b)

    with _como_gerente(ws, r, gerente, forest):
        await TaskService(db).move(
            task_id=mae.id, command=MoveTaskCommand(project_id=proj_a)
        )
        await db.flush()

    assert await _seguidores(db, filha.id) == set()
    assert await _historico(db, filha.id, "unwatched") == [
        {"target_user_id": str(op_b), "by_self": False, "reason": "lost_access"}
    ]


# ----------------------------------------------------------
# O cadeado do `+` vem do servidor
# ----------------------------------------------------------
async def test_http_can_manage_watchers_segue_a_regra_do_servico(db) -> None:
    """`can_manage_watchers` responde a MESMA pergunta de
    `_assert_can_manage_others`: `task.assign` no time da tarefa + edicao.

    O operador de A ve a tarefa de B (pelo projeto de A) e NAO pode por
    outra pessoa -- o campo tem de dizer `false`, senao a tela ofereceria um
    `+` que o servidor recusa.
    """
    from app.modules.auth.domain.permissions import permissions_for_actor

    ws, r, a, b, gerente, op_a, op_b, forest = await _mundo(db)
    proj_a = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=a)
    task_b = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=b, project_id=proj_a
    )
    await db.commit()

    vinculos_op = (Membership(team_id=a, role="OPERATOR"),)
    ctx_op = TenantContext(
        workspace_id=ws, user_id=op_a, roles=frozenset({"OPERATOR"}),
        permissions=permissions_for_actor(memberships=vinculos_op, tree=forest),
        memberships=vinculos_op, team_tree=forest,
    )
    async with cliente(db, ctx_op) as c:
        visto_pelo_op = await c.get(f"/api/v1/tasks/{task_b.id}")
    vinculos_ger = (Membership(team_id=r, role="MANAGER"),)
    ctx_ger = TenantContext(
        workspace_id=ws, user_id=gerente, roles=frozenset({"MANAGER"}),
        permissions=permissions_for_actor(memberships=vinculos_ger, tree=forest),
        memberships=vinculos_ger, team_tree=forest,
    )
    async with cliente(db, ctx_ger) as c:
        visto_pelo_gerente = await c.get(f"/api/v1/tasks/{task_b.id}")

    assert visto_pelo_op.status_code == 200, visto_pelo_op.text
    assert visto_pelo_op.json()["can_manage_watchers"] is False
    assert visto_pelo_gerente.json()["can_manage_watchers"] is True
