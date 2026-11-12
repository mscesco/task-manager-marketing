"""`coluna_para_status`: ponte (`legacy_status`) primeiro, depois a coluna
`is_default_target` da semantica, senao erro.

Contra Postgres porque a regra mora no `ORDER BY`. O quadro de quatro colunas
importa: nele "alvo da semantica" e "primeira coluna" dao respostas diferentes.
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
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz com o quadro geral de 8 colunas + um quadro de 4 colunas."""
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
        org_role="ADMIN",
        team_tree=(node(raiz),),
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


async def test_o_degrau_exato_vem_antes_do_alvo_da_semantica(db) -> None:
    """`EXTERNAL_APPROVAL` tem coluna propria e ha um alvo da mesma semantica:
    a ponte ganha."""
    ctx, ws, raiz, user, _ = await _mundo(db)
    geral, _ = await _quadro_geral_e_coluna(db, ctx, raiz)

    with acting_as(**ctx):
        col, status = await BoardRepository(db).coluna_para_status(
            board_id=geral, status=TaskStatus.EXTERNAL_APPROVAL
        )

    assert col == await _coluna_por_nome(
        db, board_id=geral, nome="Aprovação Externa"
    )
    assert status is TaskStatus.EXTERNAL_APPROVAL


async def test_as_oito_colunas_padrao_nunca_alcancam_o_degrau_dois(db) -> None:
    """No quadro geral os oito status respondem pela ponte, com o status intacto."""
    ctx, ws, raiz, user, _ = await _mundo(db)
    geral, _ = await _quadro_geral_e_coluna(db, ctx, raiz)

    for status in TaskStatus:
        with acting_as(**ctx):
            col, efetivo = await BoardRepository(db).coluna_para_status(
                board_id=geral, status=status
            )
        esperada = (
            await db.execute(
                select(BoardColumn.id).where(
                    BoardColumn.board_id == geral,
                    BoardColumn.legacy_status == status,
                )
            )
        ).scalar_one()
        assert col == esperada, status.value
        assert efetivo is status, status.value


@pytest.mark.parametrize(
    "pedido,coluna_esperada,status_esperado",
    [
        (TaskStatus.PLANNED, "Backlog", TaskStatus.BACKLOG),
        (TaskStatus.IN_REVIEW, "Em Andamento", TaskStatus.IN_PROGRESS),
        (TaskStatus.EXTERNAL_APPROVAL, "Em Andamento", TaskStatus.IN_PROGRESS),
        (TaskStatus.BLOCKED, "Em Andamento", TaskStatus.IN_PROGRESS),
    ],
    ids=lambda v: getattr(v, "value", v),
)
async def test_status_sem_coluna_cai_no_alvo_da_semantica(
    db, pedido, coluna_esperada, status_esperado
) -> None:
    """Status sem coluna cai no alvo da semantica. `Backlog` e a primeira coluna
    por posicao, entao so os casos `Em Andamento` distinguem as duas regras."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)

    with acting_as(**ctx):
        col, efetivo = await BoardRepository(db).coluna_para_status(
            board_id=quadro4.id, status=pedido
        )

    assert col == await _coluna_por_nome(
        db, board_id=quadro4.id, nome=coluna_esperada
    )
    assert efetivo is status_esperado


async def test_o_status_gravado_na_tarefa_e_o_da_coluna_que_recebeu(db) -> None:
    """Pelo servico: pedir `BLOCKED` num quadro de quatro grava `IN_PROGRESS`,
    o status da coluna que recebeu."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    t = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="alvo"
    )
    coluna_inicial = await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Backlog"
    )
    t.board_id = quadro4.id
    t.column_id = coluna_inicial
    t.status = TaskStatus.BACKLOG
    await db.flush()

    with acting_as(**ctx):
        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.BLOCKED, fields_set=frozenset({"status"})
            ),
        )
    await db.flush()
    await db.refresh(t)

    assert t.board_id == quadro4.id
    assert t.column_id == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Em Andamento"
    )
    assert t.status is TaskStatus.IN_PROGRESS


async def test_subtarefa_em_quadro_de_quatro_colunas_nasce_com_status_derivado(
    db,
) -> None:
    """Subtarefa herda o quadro do pai e grava o status da coluna que recebeu."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    pai = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="pai"
    )
    # Resolver a coluna antes de mexer em `board_id`: o autoflush gravaria o
    # par (quadro novo, coluna velha) e a FK composta recusaria.
    coluna_pai = await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Backlog"
    )
    pai.board_id = quadro4.id
    pai.column_id = coluna_pai
    pai.status = TaskStatus.BACKLOG
    await db.flush()

    with acting_as(**ctx):
        filha = await TaskService(db).create(
            CreateTaskCommand(
                title="filha",
                parent_task_id=pai.id,
                team_id=raiz,
                assignee_ids=[user],
                status=TaskStatus.IN_REVIEW,
            )
        )
    await db.flush()

    assert filha.board_id == quadro4.id
    assert filha.column_id == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Em Andamento"
    )
    assert filha.status is TaskStatus.IN_PROGRESS


async def test_sem_ponte_e_sem_alvo_continua_levantando(db) -> None:
    """Sem ponte e sem alvo para a semantica, levanta em vez de escolher uma
    coluna qualquer. Estado montado a mao."""
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    cancelado = (
        await db.execute(
            select(BoardColumn).where(
                BoardColumn.board_id == quadro4.id,
                BoardColumn.semantic == ColumnSemantic.CANCELLED,
            )
        )
    ).scalar_one()
    cancelado.is_default_target = False
    cancelado.legacy_status = None
    await db.flush()

    with acting_as(**ctx):
        with pytest.raises(ValidationError):
            await BoardRepository(db).coluna_para_status(
                board_id=quadro4.id, status=TaskStatus.CANCELLED
            )


async def test_coluna_sem_ponte_nao_ganha_do_casamento_exato(db) -> None:
    """Coluna sem ponte marcada como alvo nao ganha do casamento exato.

    Depende do `DESC NULLS LAST`: a comparacao com a ponte da NULL (nao FALSE)
    na coluna sem ponte, e o Postgres poe NULL primeiro num `DESC`.
    """
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    andamento = (
        await db.execute(
            select(BoardColumn).where(
                BoardColumn.board_id == quadro4.id,
                BoardColumn.semantic == ColumnSemantic.IN_PROGRESS,
            )
        )
    ).scalar_one()
    andamento.is_default_target = False
    await db.flush()
    db.add(
        BoardColumn(
            workspace_id=ws,
            board_id=quadro4.id,
            name="Em Revisão",
            color="var(--status-review-dot)",
            position=90,
            semantic=ColumnSemantic.IN_PROGRESS,
            notify_deadline=True,
            is_default_target=True,
            legacy_status=None,
        )
    )
    await db.flush()

    with acting_as(**ctx):
        col, efetivo = await BoardRepository(db).coluna_para_status(
            board_id=quadro4.id, status=TaskStatus.IN_PROGRESS
        )

    assert col == andamento.id
    assert efetivo is TaskStatus.IN_PROGRESS

    # status sem ponte cai na coluna nova, que agora e o alvo
    with acting_as(**ctx):
        col2, efetivo2 = await BoardRepository(db).coluna_para_status(
            board_id=quadro4.id, status=TaskStatus.BLOCKED
        )
    assert col2 == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Em Revisão"
    )
    assert efetivo2 is TaskStatus.IN_PROGRESS


async def _quadro_geral_e_coluna(db, ctx, root_team_id):
    """`board_id` do quadro geral daquele time raiz."""
    with acting_as(**ctx):
        return await BoardRepository(db).default_board_and_column_for_status(
            TaskStatus.BACKLOG, root_team_id=root_team_id
        )
