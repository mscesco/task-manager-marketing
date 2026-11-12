"""Caminhos que escrevem status, contra quadro de quatro colunas.

A cascata de conclusao (`TaskRepository.complete_descendants`) repete em SQL a
regra de achar a coluna (ponte primeiro, depois a coluna alvo da semantica);
estes testes mantem as duas copias concordando.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    quadro4 = await f.make_board(
        db,
        workspace_id=ws,
        team_id=raiz,
        name="Quadro de quatro",
        colunas=COLUNAS_BASE,
    )
    await db.flush()
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        team_tree=(node(raiz),),
        org_role="ADMIN",
    )
    return ctx, ws, raiz, user, quadro4


async def _coluna_por_nome(db, *, board_id, nome: str):
    return (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == board_id, BoardColumn.name == nome
            )
        )
    ).scalar_one()


async def _mae_com_filha(db, ctx, ws, raiz, user, quadro):
    """Mae e filha vivas no quadro dado, as duas em `Backlog`.

    A coluna e resolvida antes de mexer em `board_id`: consultar depois dispara
    autoflush com o par (quadro novo, coluna velha) e a FK composta recusa.
    """
    backlog = await _coluna_por_nome(db, board_id=quadro.id, nome="Backlog")
    mae = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="mae"
    )
    mae.board_id = quadro.id
    mae.column_id = backlog
    mae.status = TaskStatus.BACKLOG
    await db.flush()

    with acting_as(**ctx):
        filha = await TaskService(db).create(
            CreateTaskCommand(
                title="filha",
                parent_task_id=mae.id,
                team_id=raiz,
                assignee_ids=[user],
                status=TaskStatus.BACKLOG,
            )
        )
    await db.flush()
    return mae, filha


async def test_cascata_conclui_a_filha_no_quadro_de_quatro_colunas(db) -> None:
    """Controle: `Concluido` tem ponte. Sem ele o teste seguinte passaria se a
    cascata parasse de funcionar por inteiro."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    mae, filha = await _mae_com_filha(db, ctx, ws, raiz, user, quadro4)

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=mae.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(filha)

    assert filha.status is TaskStatus.COMPLETED
    assert filha.column_id == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Concluído"
    )
    assert filha.board_id == quadro4.id


async def test_cascata_acha_a_coluna_DONE_sem_ponte(db) -> None:
    """A unica coluna `DONE` nao tem ponte: a cascata acha pela semantica, em vez
    de gravar `column_id` NULL."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    mae, filha = await _mae_com_filha(db, ctx, ws, raiz, user, quadro4)

    concluido = (
        await db.execute(
            select(BoardColumn).where(
                BoardColumn.board_id == quadro4.id,
                BoardColumn.semantic == ColumnSemantic.DONE,
            )
        )
    ).scalar_one()
    concluido.legacy_status = None
    concluido.name = "Entregue"
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=mae.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(filha)

    assert filha.status is TaskStatus.COMPLETED
    assert filha.column_id == concluido.id


async def test_a_cascata_nao_come_a_ponte_quando_as_duas_existem(db) -> None:
    """Com duas colunas `DONE`, a de ponte ganha da alvo sem ponte.

    Depende do `DESC NULLS LAST`: a comparacao com a ponte da NULL (nao FALSE)
    na coluna sem ponte, e o Postgres poe NULL primeiro num `DESC`.
    """
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    mae, filha = await _mae_com_filha(db, ctx, ws, raiz, user, quadro4)

    concluido_id = await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Concluído"
    )
    concluido = (
        await db.execute(
            select(BoardColumn).where(BoardColumn.id == concluido_id)
        )
    ).scalar_one()
    concluido.is_default_target = False
    await db.flush()
    db.add(
        BoardColumn(
            workspace_id=ws,
            board_id=quadro4.id,
            name="Entregue",
            color="var(--status-done-dot)",
            position=91,
            semantic=ColumnSemantic.DONE,
            notify_deadline=True,
            is_default_target=True,
            legacy_status=None,
        )
    )
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=mae.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(filha)

    assert filha.column_id == concluido_id
    assert filha.status is TaskStatus.COMPLETED


async def test_duplicacao_em_quadro_de_quatro_colunas_deriva_o_status(
    db,
) -> None:
    """Status que o quadro de quatro colunas nao tem cai na coluna da semantica
    e o status efetivo vem dela."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    mae, filha = await _mae_com_filha(db, ctx, ws, raiz, user, quadro4)

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=filha.id,
            command=UpdateTaskCommand(
                status=TaskStatus.IN_REVIEW, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(filha)

    assert filha.status is TaskStatus.IN_PROGRESS
    assert filha.column_id == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Em Andamento"
    )
    assert filha.board_id == quadro4.id


async def test_tarefa_de_topo_em_time_raiz_de_quatro_colunas_tem_o_status_da_coluna(db) -> None:
    """Tarefa sem pai e sem quadro num time raiz de quatro colunas: o status
    gravado e o da coluna, nao o pedido."""
    import uuid

    from app.db.models import Team
    from app.modules.tasks.application.board_service import BoardService

    ws = await f.make_workspace(db)
    raiz = uuid.uuid4()
    db.add(Team(id=raiz, workspace_id=ws, parent_team_id=None, name="Raiz nova", slug="raiz-nova"))
    await db.flush()
    await BoardService(db).create_default_board(workspace_id=ws, team_id=raiz, colunas=COLUNAS_BASE)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    ctx = dict(
        workspace_id=ws, user_id=user, team_tree=(node(raiz),), org_role="ADMIN"
    )

    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="bloqueada", team_id=raiz, assignee_ids=[user], status=TaskStatus.BLOCKED
            )
        )
    nome_da_coluna = (
        await db.execute(select(BoardColumn.name).where(BoardColumn.id == t.column_id))
    ).scalar_one()
    assert (nome_da_coluna, t.status) == ("Em Andamento", TaskStatus.IN_PROGRESS)


async def test_patch_por_status_grava_no_historico_o_que_aconteceu(db) -> None:
    """O historico registra o status efetivo e a troca de coluna, nao o status pedido."""
    from app.db.models import TaskHistory

    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    backlog = await _coluna_por_nome(db, board_id=quadro4.id, nome="Backlog")
    andamento = await _coluna_por_nome(db, board_id=quadro4.id, nome="Em Andamento")
    t = await f.make_task(db, workspace_id=ws, created_by=user, team_id=raiz, title="t")
    t.board_id, t.column_id, t.status = quadro4.id, backlog, TaskStatus.BACKLOG
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(status=TaskStatus.BLOCKED, fields_set=frozenset({"status"})),
        )
    await db.flush()

    linhas = (
        await db.execute(select(TaskHistory).where(TaskHistory.task_id == t.id))
    ).scalars().all()
    por_campo = {h.field_name: h.new_value for h in linhas if h.field_name}
    assert "BLOCKED" not in str(por_campo)
    assert "IN_PROGRESS" in str(por_campo["status"])
    assert str(andamento) in str(por_campo["column_id"])
