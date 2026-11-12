"""Duplicacao com responsavel decidido POR SUBTAREFA (`subtask_assignees`).

Para cada filha DIRETA da origem, o modal manda quem responde por ela, ou pede
para nao leva-la. Estes testes defendem:

  1. Que a escolha explicita ganha da heranca.
  2. Que chave desconhecida (neto, subtarefa arquivada) vira erro, e nao
     silencio: seria uma decisao tomada na tela que o backend joga fora.
  3. Que lista VAZIA e recusada. `assign_many_or_fail([])` e no-op
     silencioso, e sem esta trava a filha nasceria orfa com 200.
  4. Que o neto herda de quem foi decidido para a mae dele.

⚠️ TODA LEITURA DEPOIS DO ATO PRECISA DE `acting_as`: `list_children` e
`assignee_ids_for` chamam `require_tenant()`, e fora do bloco o teste cai com
`MissingTenantContextError`, por motivo nenhum ligado ao produto.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz com ADMIN de organizacao + duas pessoas que alcancam tudo (tarefa da raiz)."""
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    ana = await f.make_user(db, workspace_id=ws)
    bia = await f.make_user(db, workspace_id=ws)
    for u in (ana, bia):
        await f.add_member(
            db,
            workspace_id=ws,
            user_id=u,
            team_id=team,
            role="OPERATOR",
        )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=admin, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        org_role="ADMIN",
        team_tree=(node(team),),
    )
    return ws, team, admin, ana, bia, proj, ctx


async def _arvore(db, ctx, proj, team, dono):
    """origem -> filha1 (com neto) + filha2. Todas com `dono`."""
    with acting_as(**ctx):
        svc = TaskService(db)
        origem = await svc.create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=team,
                assignee_ids=[dono],
            )
        )
        filha1 = await svc.create(
            CreateTaskCommand(
                title="Roteiro",
                project_id=proj,
                team_id=team,
                parent_task_id=origem.id,
                assignee_ids=[dono],
            )
        )
        neto = await svc.create(
            CreateTaskCommand(
                title="Legendas",
                project_id=proj,
                team_id=team,
                parent_task_id=filha1.id,
                assignee_ids=[dono],
            )
        )
        filha2 = await svc.create(
            CreateTaskCommand(
                title="Arte",
                project_id=proj,
                team_id=team,
                parent_task_id=origem.id,
                assignee_ids=[dono],
            )
        )
    return origem, filha1, neto, filha2


async def _filha_por_titulo(db, pai_id, titulo):
    from app.modules.tasks.infrastructure.task_repository import TaskRepository

    filhos = await TaskRepository(db).list_children(parent_task_id=pai_id)
    return next(f_ for f_ in filhos if f_.title == titulo)


def _cmd(source_id, proj, team, dono, **extra):
    base = dict(
        source_id=source_id,
        title="Cópia de Campanha",
        project_id=proj,
        team_id=team,
        assignee_ids=[dono],
        include_subtasks=True,
    )
    base.update(extra)
    return DuplicateTaskCommand(**base)


async def test_escolha_explicita_ganha_da_heranca(db) -> None:
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(
                origem.id,
                proj,
                team,
                admin,
                subtask_assignees={filha1.id: [bia]},
            )
        )

    with acting_as(**ctx):
        colab = CollaborationService(db)
        copia1 = await _filha_por_titulo(db, r.task.id, "Roteiro")
        copia2 = await _filha_por_titulo(db, r.task.id, "Arte")
        # A que foi decidida no passo 2 vai pra Bia...
        assert await colab.assignee_ids_for(copia1) == [bia]
        # ...e a que NAO foi decidida segue a heranca (Ana), como antes.
        assert await colab.assignee_ids_for(copia2) == [ana]


async def test_neto_herda_de_quem_foi_decidido_pra_mae(db) -> None:
    """O modal so lista filhas DIRETAS; o neto segue a mae na copia."""
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(
                origem.id,
                proj,
                team,
                admin,
                subtask_assignees={filha1.id: [bia]},
            )
        )

    with acting_as(**ctx):
        copia1 = await _filha_por_titulo(db, r.task.id, "Roteiro")
        copia_neto = await _filha_por_titulo(db, copia1.id, "Legendas")
        assert await CollaborationService(db).assignee_ids_for(
            copia_neto
        ) == [bia]


async def test_pular_subtarefa_leva_a_subarvore_dela(db) -> None:
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(origem.id, proj, team, admin, skip_subtasks=[filha1.id])
        )

    from app.modules.tasks.infrastructure.task_repository import TaskRepository

    with acting_as(**ctx):
        filhas = await TaskRepository(db).list_children(
            parent_task_id=r.task.id
        )
    # ⚠️ "Legendas" era neta POR BAIXO de "Roteiro": sem a mae, ela nao tem
    # onde se pendurar. Nao pode ter virado filha direta da copia.
    assert sorted(f_.title for f_ in filhas) == ["Arte"]


async def test_lista_vazia_no_mapa_e_recusada(db) -> None:
    """⚠️ Sem esta trava, `assign_many_or_fail([])` e no-op SILENCIOSO e a
    filha nasce orfa com 200 na resposta."""
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        with pytest.raises(ValidationError) as e:
            await TaskService(db).duplicate(
                _cmd(
                    origem.id,
                    proj,
                    team,
                    admin,
                    subtask_assignees={filha1.id: []},
                )
            )
    assert "responsável" in str(e.value)


async def test_chave_que_nao_e_filha_direta_e_recusada(db) -> None:
    """Id de NETO no mapa: a pessoa decidiu algo que o backend ignoraria."""
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await TaskService(db).duplicate(
                _cmd(
                    origem.id,
                    proj,
                    team,
                    admin,
                    subtask_assignees={neto.id: [bia]},
                )
            )


async def test_decisao_sem_include_subtasks_e_incoerencia(db) -> None:
    ws, team, admin, ana, bia, proj, ctx = await _mundo(db)
    origem, filha1, neto, filha2 = await _arvore(db, ctx, proj, team, ana)

    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await TaskService(db).duplicate(
                _cmd(
                    origem.id,
                    proj,
                    team,
                    admin,
                    include_subtasks=False,
                    subtask_assignees={filha1.id: [bia]},
                )
            )

