"""Spec 053, fatia B -- o backend de SEGUIR uma tarefa.

A tela diz "seguir"; o codigo e o banco continuam dizendo `watcher`.

O QUE ESTE ARQUIVO PRENDE:
  - por/tirar OUTRA pessoa grava historico e avisa quem foi posto/tirado (D13,
    D17); seguir a si mesmo grava historico e NAO avisa;
  - tarefa arquivada: seguidores so leitura, 422 `tarefa_arquivada` (D10);
  - a permissao de por terceiro e perguntada NO TIME DA TAREFA (§6.1);
  - criar com `watcher_ids` pelo HTTP -- a linha do router (§6.10) -- e o 422
    atomico;
  - trocar o time (PATCH) ou o projeto (move) tira quem deixou de alcancar,
    com `lost_access` no historico e SEM aviso (D12, §6.8).

SABOTAGENS (medidas):
  A. Em `tasks_router.create_task`, apagar a linha `watcher_ids=payload.watcher_ids`.
     Deve cair `test_http_cria_com_seguidor`.
  B. Em `TaskService.move`, apagar a chamada a `remove_watchers_without_reach`.
     Deve cair `test_trocar_projeto_tira_seguidor_da_subarvore`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Notification, TaskWatcher
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
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
from tests.integration.conftest import acting_as, mship, node

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
    # avisos se ANULAM (Spec 053, D18, fatia C). Cada um sozinho avisa -- ver
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
    perguntada no `task.team_id` (Spec 051). Projeto de A, tarefa de B -> o
    operador de A ve pelo projeto e nao tem `task.assign` em B.

    ⚠️ Ate a Spec 053 este 403 vinha da EDICAO (`assert_editable`), nao da
    permissao -- a pergunta era "tem `task.assign` em algum time". O
    `required_permission` nos detalhes e o que prova qual portao barrou.
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
def _cliente(db, ctx: TenantContext) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


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
    async with _cliente(db, _ctx_gerente(ws, r, gerente, forest)) as c:
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
    async with _cliente(db, _ctx_gerente(ws, r, gerente, forest)) as c:
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
    proj_a = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=a)
    proj_b = await f.make_project(db, workspace_id=ws, created_by=gerente, team_id=b)
    mae = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=a, project_id=proj_a
    )
    filha = await f.make_task(
        db, workspace_id=ws, created_by=gerente, team_id=a, project_id=proj_a,
        parent=mae,
    )
    await f.make_watcher(db, workspace_id=ws, task_id=filha.id, user_id=op_a)

    with _como_gerente(ws, r, gerente, forest):
        await TaskService(db).move(
            task_id=mae.id, command=MoveTaskCommand(project_id=proj_b)
        )
        await db.flush()

    assert await _seguidores(db, filha.id) == set()
    assert await _historico(db, filha.id, "unwatched") == [
        {"target_user_id": str(op_a), "by_self": False, "reason": "lost_access"}
    ]
