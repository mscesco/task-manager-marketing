"""ADR 0042 -- status sem coluna cai no `is_default_target` da semantica.

Contra Postgres real, porque a decisao inteira mora no `ORDER BY` de uma query:
a ordem dos degraus e o `DESC NULLS LAST` nao existem em lugar nenhum do
dominio, e nenhum teste puro os alcanca.

⚠️ O FIXTURE E O QUE FAZ ESTE ARQUIVO VALER ALGUMA COISA. Um quadro de QUATRO
colunas (`COLUNAS_BASE`) tem uma coluna por semantica, entao "o alvo da
semantica" e "a primeira coluna que achar" dao respostas DIFERENTES para
`IN_REVIEW`, `EXTERNAL_APPROVAL` e `BLOCKED` -- a primeira por posicao e
`Backlog` e o alvo certo e `Em Andamento`. Fosse `make_board(com_legacy_status=
False)`, com oito colunas dividindo quatro semanticas, a regra certa e a errada
poderiam coincidir e a sabotagem passaria verde. Foi assim que tres sabotagens
passaram verde na 4c.
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
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz com o quadro geral de 8 colunas + um quadro de 4 colunas."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
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
        memberships=(mship(raiz, "ADMIN"),),
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


# ---------------------------------------------------------------- degrau 1


async def test_o_degrau_exato_vem_antes_do_alvo_da_semantica(db) -> None:
    """⚠️ O TESTE QUE PRENDE A ORDEM DOS DEGRAUS (ADR 0042 D1).

    No Quadro geral, `EXTERNAL_APPROVAL` tem coluna propria E existe uma coluna
    `is_default_target` da mesma semantica (`Em Andamento`). As duas satisfazem
    o WHERE; so o `ORDER BY` separa.

    Invertendo os degraus, a tarefa vai parar em `Em Andamento`: coluna valida,
    do quadro certo, com a semantica certa -- e NENHUM outro portao pega. Este
    teste e o unico lugar onde essa inversao aparece.
    """
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
    """⚠️ O TESTE QUE PROVA QUE PRODUCAO NAO SE MEXE.

    Os oito status respondem pela ponte no Quadro geral, e o status devolvido e
    identico ao pedido. Vermelho aqui significa que a ADR 0042 vazou para o
    quadro que ela nao deveria tocar.
    """
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


# ---------------------------------------------------------------- degrau 2


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
    """Os quatro status que um quadro de quatro colunas nao conhece.

    ⚠️ `Backlog` E A PRIMEIRA COLUNA POR POSICAO neste quadro. Os tres casos
    que esperam `Em Andamento` sao os que distinguem "alvo da semantica" de
    "primeira coluna que achar"; o caso do `PLANNED` sozinho nao distinguiria
    nada, e esta aqui so para cobrir a semantica `OPEN`.
    """
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
    """⚠️ A D2 DA ADR 0042, PELO CAMINHO DO PRODUTO E NAO DO REPOSITORIO.

    Pedir `BLOCKED` num quadro de quatro colunas tem EXITO e a tarefa vira
    `IN_PROGRESS`. Gravar `command.status` aqui deixaria o card em
    `Em Andamento` e a tarefa agrupada em `Bloqueado` no `/minhas-tarefas` --
    dois lugares discordando sobre a mesma tarefa -- e poria a invariante 3 do
    `invariantes.sql` em diferente de zero.
    """
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
    """O outro chamador: `create` com pai.

    A subtarefa herda o quadro do pai (F2) e, se o pai vive num quadro de
    quatro colunas, o status pedido pode nao existir la. O `create` tem de
    gravar o status da coluna que recebeu, e nao o pedido.
    """
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    pai = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=raiz, title="pai"
    )
    # ⚠️ A COLUNA E RESOLVIDA ANTES DE QUALQUER ATRIBUICAO. Consultar depois
    # de mexer em `board_id` dispara AUTOFLUSH e grava o par
    # `(quadro novo, coluna velha)`, que nao existe -- a FK composta recusa
    # antes de o teste testar coisa nenhuma. Armadilha ja documentada em
    # `test_board_scoping_db._mover_para_quadro`.
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


# ---------------------------------------------------------------- degrau 3


async def test_sem_ponte_e_sem_alvo_continua_levantando(db) -> None:
    """⚠️ A TRAVA ALTA NAO FOI REMOVIDA, SO GANHOU UM DEGRAU ANTES DELA.

    Desmarcando o alvo da semantica `CANCELLED`, o quadro deixa de ter resposta
    para `CANCELLED` -- e a resposta certa continua sendo erro, e nao uma
    coluna qualquer.

    ⚠️ Este estado nao vai ser alcancavel pelo CRUD da fatia 5b-4, que recusa
    apagar a ultima `OPEN` e a ultima `DONE` e mantem um alvo por semantica
    presente. Ele e montado aqui A MAO, por escrita direta, porque a trava do
    repositorio tem de valer mesmo para quadro montado por fora do produto.
    """
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
    """⚠️ O `DESC NULLS LAST` DO `ORDER BY`, e ele nao e enfeite.

    `legacy_status = :status` e NULL -- e nao FALSE -- para coluna criada por
    gente, e o Postgres poe NULL PRIMEIRO num `ORDER BY ... DESC`. Sem o
    `NULLS LAST`, uma coluna sem ponte marcada como alvo ganharia do casamento
    exato, e o degrau 2 comeria o degrau 1 por acidente de SQL.

    O mundo montado aqui e o menor que expoe isso: uma quinta coluna
    `IN_PROGRESS`, sem ponte, marcada como alvo no lugar de `Em Andamento`.
    Pedir `IN_PROGRESS` tem de devolver `Em Andamento` mesmo assim, porque a
    ponte responde primeiro.
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

    # ...e um status SEM ponte cai na coluna nova, que agora e o alvo.
    with acting_as(**ctx):
        col2, efetivo2 = await BoardRepository(db).coluna_para_status(
            board_id=quadro4.id, status=TaskStatus.BLOCKED
        )
    assert col2 == await _coluna_por_nome(
        db, board_id=quadro4.id, nome="Em Revisão"
    )
    assert efetivo2 is TaskStatus.IN_PROGRESS


async def _quadro_geral_e_coluna(db, ctx, area_id):
    """`board_id` do quadro geral DAQUELA AREA.

    ⚠️ O `area_id` virou obrigatorio na Spec 046 (fatia 4): com N areas,
    "o quadro geral do workspace" deixou de ser uma coisa so.
    """
    with acting_as(**ctx):
        return await BoardRepository(db).default_board_and_column_for_status(
            TaskStatus.BACKLOG, area_id=area_id
        )
