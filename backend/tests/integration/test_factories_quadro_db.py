"""O ARREIO de teste sabe que existe mais de um quadro (06/08).

Testes DA FACTORY, e nao do produto. Existem porque a `make_task` cravava o
quadro do time raiz -- o mesmo SQL que a F2 tirou do `BoardRepository` -- e uma
factory errada nao aparece em lugar nenhum: ela nao muda a contagem de testes,
nao deixa a suite vermelha e nao chega em producao. Ela mente para os testes
que ainda vao ser escritos, que aqui sao os da F3 (`GET /boards`, com permissao)
e os da F5 (quadro interno).

⚠️ O DEFEITO QUE ESTES TESTES FECHAM E O SILENCIOSO. Uma filha nascida no
quadro geral com a coluna do quadro geral e um par internamente consistente: a
FK composta `(column_id, board_id)` ACEITA. Pai num quadro, filha em outro, sem
erro e sem tela. E por isso que o caso 3 (heranca do pai) e o que mais importa
aqui, e nao o caso 2.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService
from tests.integration import factories as f

pytestmark = pytest.mark.integration


async def _colunas(db, board_id: uuid.UUID) -> list[BoardColumn]:
    return list(
        (
            await db.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == board_id)
                .order_by(BoardColumn.position)
            )
        ).scalars()
    )


async def _quadro_geral(db, ws: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(
            select(Board.id).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalars().first()


# 1 -- as DUAS regras de "quadro com colunas padrao" concordam.
#      `make_board` monta a linha direto em vez de chamar o `BoardService`
#      (o motivo esta no docstring dela: o estado intermediario
#      `is_default=True` viola o indice parcial). Duas regras convivendo
#      precisam de um teste comparando as duas -- mesmo remedio que a 035 usou
#      para a lista da migration versus a do servico.
async def test_make_board_gera_o_mesmo_quadro_que_o_servico(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)

    pelo_servico = await BoardService(db).create_default_board(
        workspace_id=ws, team_id=sub_a
    )
    pela_factory = await f.make_board(
        db, workspace_id=ws, team_id=sub_b, is_default=True
    )

    do_servico = await _colunas(db, pelo_servico.id)
    da_factory = await _colunas(db, pela_factory.id)

    assert len(do_servico) == len(da_factory) > 0
    for a, b in zip(do_servico, da_factory, strict=True):
        assert (
            a.name,
            a.color,
            a.position,
            a.semantic,
            a.notify_deadline,
            a.is_default_target,
            a.legacy_status,
        ) == (
            b.name,
            b.color,
            b.position,
            b.semantic,
            b.notify_deadline,
            b.is_default_target,
            b.legacy_status,
        )


# 2 -- trava de regressao: sem `board_id` e sem `parent`, nada muda.
#      Os 108 usos existentes de `make_task` dependem disto.
async def test_make_task_sem_board_continua_no_quadro_geral(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    outro = await f.make_board(db, workspace_id=ws, team_id=sub)

    t = await f.make_task(db, workspace_id=ws, created_by=user, team_id=raiz)

    geral = await _quadro_geral(db, ws)
    assert t.board_id == geral
    # ...e o segundo quadro existir no workspace nao muda a resposta.
    assert t.board_id != outro.id


# 3 -- `board_id=` coloca a tarefa NAQUELE quadro, com a coluna DAQUELE quadro.
async def test_make_task_com_board_usa_a_coluna_daquele_quadro(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)

    t = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=sub,
        board_id=interno.id,
        status=TaskStatus.IN_PROGRESS,
    )

    assert t.board_id == interno.id
    colunas = {c.legacy_status: c.id for c in await _colunas(db, interno.id)}
    assert t.column_id == colunas[TaskStatus.IN_PROGRESS]
    # E a prova de que nao pegou a coluna homonima do quadro geral:
    geral = await _quadro_geral(db, ws)
    do_geral = {c.legacy_status: c.id for c in await _colunas(db, geral)}
    assert t.column_id != do_geral[TaskStatus.IN_PROGRESS]


# 4 -- ⚠️ O QUE MAIS IMPORTA. Subtarefa herda o quadro do pai, igual ao produto
#      depois da F2. Sem isto a factory monta a arvore partida em silencio, e
#      um teste de arvore dentro do quadro interno passaria verde afirmando o
#      contrario do que o produto faz.
async def test_make_task_com_pai_herda_o_quadro_do_pai(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)

    pai = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=sub,
        board_id=interno.id,
        title="pai",
    )
    filha = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=sub,
        parent=pai,
        title="filha",
        status=TaskStatus.PLANNED,
    )

    geral = await _quadro_geral(db, ws)
    assert filha.board_id == pai.board_id == interno.id
    assert filha.board_id != geral
    colunas = {c.legacy_status: c.id for c in await _colunas(db, interno.id)}
    assert filha.column_id == colunas[TaskStatus.PLANNED]


# 5 -- montar a arvore partida a mao e RECUSADO pelo arreio.
async def test_make_task_recusa_board_conflitante_com_o_pai(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    interno = await f.make_board(db, workspace_id=ws, team_id=sub)
    geral = await _quadro_geral(db, ws)

    pai = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=sub, board_id=interno.id
    )

    with pytest.raises(AssertionError, match="diferente do quadro do pai"):
        await f.make_task(
            db,
            workspace_id=ws,
            created_by=user,
            team_id=sub,
            parent=pai,
            board_id=geral,
        )


# 6 -- o mundo da D4: quadro cujas colunas foram criadas por GENTE nao responde
#      por status. Falhar ALTO aqui e o comportamento correto ate a derivacao
#      pela semantica existir -- escolher "a primeira coluna que achar" e
#      exatamente o defeito que a Spec 035 inteira existe para evitar.
async def test_make_task_recusa_quadro_sem_coluna_para_o_status(db) -> None:
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    sem_ponte = await f.make_board(
        db, workspace_id=ws, team_id=sub, com_legacy_status=False
    )

    # o quadro TEM colunas -- so nao tem ponte com status.
    assert len(await _colunas(db, sem_ponte.id)) > 0
    assert all(c.legacy_status is None for c in await _colunas(db, sem_ponte.id))

    with pytest.raises(AssertionError, match="nao tem coluna com legacy_status"):
        await f.make_task(
            db,
            workspace_id=ws,
            created_by=user,
            team_id=sub,
            board_id=sem_ponte.id,
        )
