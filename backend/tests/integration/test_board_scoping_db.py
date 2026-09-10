"""F2 -- a coluna e procurada DENTRO do quadro da tarefa.

Contra Postgres real. Este e o primeiro arquivo do repositorio que monta DOIS
quadros com colunas padrao e faz o produto operar sobre o segundo. Ate aqui
todo teste vivia num mundo de um quadro so -- e era exatamente por isso que a
consulta cravada no quadro do time raiz passava despercebida.

Os dois defeitos que a F2 fecha falham de formas DIFERENTES, e por isso sao
dois testes e nao um:

  - **edicao de status**: `board_id` fica, a coluna vinha do quadro geral, e o
    par `(coluna do geral, board interno)` nao existe -> a FK composta recusa.
    Erro alto ao salvar.
  - **subtarefa**: nasceria com `board_id` do geral E coluna do geral -- par
    internamente consistente, FK ACEITA. Pai num quadro, filha em outro, sem
    erro e sem tela. Este e o silencioso.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Workspace com time raiz (quadro geral) + subtime COM quadro proprio.

    ⚠️ O quadro do subtime e criado A MAO pelo `BoardService`, e nao pela
    factory. `make_team` so cria quadro na RAIZ, porque e o que o produto faz
    (ADR 0032) -- subtime nao ganha quadro por existir. Aqui o quadro do
    subtime e o mundo do dia do quadro interno, montado antes de ele existir.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    subtime = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    quadro2 = await BoardService(db).create_default_board(
        workspace_id=ws, team_id=subtime,
        colunas=COLUNAS_PADRAO,
    )
    await db.flush()
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz), node(subtime, raiz)),
    )
    return ctx, ws, raiz, subtime, user, quadro2


async def _coluna(db, *, board_id, status: TaskStatus):
    """`column_id` daquele status naquele quadro, lido do banco."""
    return (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == board_id,
                BoardColumn.legacy_status == status,
            )
        )
    ).scalar_one()


async def _quadro_geral(db, ws):
    return (
        await db.execute(
            select(Board.id).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalars().first()


async def _mover_para_quadro(db, task, *, board_id, status: TaskStatus):
    """Coloca a tarefa no outro quadro, na coluna correspondente ao status.

    Escrita direta porque mover tarefa entre quadros nao existe no produto (e
    a D6 do memo de decisoes diz que nao vai existir). O que este helper monta
    e o estado FINAL do quadro interno, nao um caminho de usuario.

    ⚠️ A COLUNA E RESOLVIDA ANTES DE QUALQUER ATRIBUICAO, e isso nao e estilo.
    A primeira versao fazia `task.board_id = board_id` e so entao consultava a
    coluna -- e essa consulta dispara AUTOFLUSH, que grava a tarefa com o
    `board_id` novo e o `column_id` ainda do quadro geral. Par inexistente, FK
    composta recusa, `ForeignKeyViolationError` antes de o teste chegar a
    testar qualquer coisa. Os dois campos tem de virar na MESMA gravacao.
    """
    coluna = await _coluna(db, board_id=board_id, status=status)
    task.board_id = board_id
    task.column_id = coluna
    await db.flush()


# 1 -- editar o status procura a coluna no quadro DA TAREFA.
#      Sem a F2 o repositorio devolvia a coluna do quadro geral e a FK composta
#      recusava a gravacao: salvar um status viraria erro.
async def test_edicao_de_status_usa_a_coluna_do_quadro_da_tarefa(db) -> None:
    ctx, ws, raiz, subtime, user, quadro2 = await _mundo(db)
    t = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="interna"
    )
    await _mover_para_quadro(
        db, t, board_id=quadro2.id, status=TaskStatus.BACKLOG
    )

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.IN_PROGRESS, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(t)

    # A tarefa NAO mudou de quadro...
    assert t.board_id == quadro2.id
    # ...e a coluna nova e a do quadro DELA, nao a do geral.
    assert t.column_id == await _coluna(
        db, board_id=quadro2.id, status=TaskStatus.IN_PROGRESS
    )


# 2 -- subtarefa nasce no quadro DO PAI.
#      Este e o defeito silencioso: sem a F2 a filha nasceria no quadro geral
#      com a coluna do geral -- par consistente, FK aceita, arvore partida
#      entre dois quadros.
async def test_subtarefa_nasce_no_quadro_do_pai(db) -> None:
    ctx, ws, raiz, subtime, user, quadro2 = await _mundo(db)
    pai = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="pai interna"
    )
    await _mover_para_quadro(
        db, pai, board_id=quadro2.id, status=TaskStatus.BACKLOG
    )

    with acting_as(**ctx):
        filha = await TaskService(db).create(
            CreateTaskCommand(
                title="filha",
                parent_task_id=pai.id,
                assignee_ids=[user],
            )
        )
    await db.flush()

    assert filha.board_id == quadro2.id
    assert filha.column_id == await _coluna(
        db, board_id=quadro2.id, status=TaskStatus.BACKLOG
    )


# 3 -- tarefa de TOPO continua nascendo no quadro geral, mesmo existindo um
#      segundo quadro no workspace. E a trava contra "consertar" o create
#      passando a herdar quadro de qualquer lugar: sem pai, o quadro e o da
#      raiz, e a ADR 0032 nao mudou.
async def test_tarefa_de_topo_continua_nascendo_no_quadro_geral(db) -> None:
    ctx, ws, raiz, subtime, user, quadro2 = await _mundo(db)
    geral = await _quadro_geral(db, ws)

    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(title="topo", team_id=raiz, assignee_ids=[user])
        )
    await db.flush()

    assert t.board_id == geral
    assert t.board_id != quadro2.id
