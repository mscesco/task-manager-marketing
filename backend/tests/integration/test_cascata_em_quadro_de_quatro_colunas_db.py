"""Fatia 5b-2 -- os caminhos que escrevem STATUS, contra quadro de 4 colunas.

⚠️ ESTE ARQUIVO EXISTE PORQUE UMA LEITURA VIROU MEDICAO E DEU ERRADO. O plano
da 5b registrou, em 11/08, que todos os caminhos de escrita por status eram
seguros num quadro de quatro colunas, "porque `OPEN`, `IN_PROGRESS`, `DONE` e
`CANCELLED` sempre tem coluna nas quatro base". A frase e verdadeira e a
conclusao e falsa: ela vale para `COLUNAS_BASE` intacto, e o CRUD da 5b-4
existe justamente para nao deixar o quadro intacto.

O levantamento, feito no codigo em 11/08:

  | caminho                                    | resolve a coluna por    | ok |
  |--------------------------------------------|-------------------------|----|
  | `TaskService.create` SEM pai                | `default_board_and_...` | *  |
  | `TaskService.create` COM pai                | `coluna_para_status`    | ok |
  | `TaskService.update` por `status`           | `coluna_para_status`    | ok |
  | `TaskService.update` por `column_id`        | `coluna_no_quadro`      | ok |
  | `TaskRepository.complete_descendants`       | SQL PROPRIO             | ** |
  | duplicacao de tarefa                        | passa pelo `create`     | ok |
  | varredura de arquivamento                   | so LE, pela semantica   | ok |
  | bloqueio de alcance (`tarefas_que_barram`)  | so LE, pela semantica   | ok |

  (*)  sempre o Quadro geral, que tem as 8 colunas com ponte. ⚠️ DEIXA DE SER
       verdade se o CRUD passar a editar as colunas do Quadro geral -- item
       explicito da 5b-4, que por ora RECUSA mexer nele.
  (**) era o furo. UPDATE em massa por `ltree`, com subconsulta propria que so
       conhecia a ponte. Corrigido em 11/08 com os dois degraus da ADR 0042.

⚠️ A DUPLICACAO DA REGRA E DELIBERADA. A cascata nao pode chamar o repositorio
uma vez por linha -- e um UPDATE unico sobre a subarvore. O preco e a regra
existir em dois lugares, e este arquivo e o unico lugar onde essa duplicacao
fica honesta. Mesmo remedio de `TERMINAL_SEMANTICS` x `TERMINAL_STATUSES`.
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
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
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


async def _mae_com_filha(db, ctx, ws, raiz, user, quadro):
    """Mae e filha vivas no quadro dado, as duas em `Backlog`.

    ⚠️ A COLUNA E RESOLVIDA ANTES DE ENCOSTAR EM `board_id`. Consultar depois
    dispara AUTOFLUSH e grava o par `(quadro novo, coluna velha)`, que nao
    existe -- a FK composta recusa antes de o teste testar coisa nenhuma.
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
    """O caso feliz: `Concluido` tem ponte, o degrau 1 responde.

    ⚠️ NAO E O TESTE QUE IMPORTA -- este passava ANTES do conserto de 11/08. Ele
    esta aqui como CONTROLE do que vem abaixo: sem ele, o teste seguinte poderia
    ficar verde por a cascata ter parado de funcionar por inteiro.
    """
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
    """⚠️ O TESTE DA FATIA. Quadro cuja unica coluna `DONE` nao tem ponte.

    Estado alcancavel pelo CRUD da 5b-4 sem quebrar nenhuma trava: criar
    `Entregue` (semantica `DONE`, sem ponte, marcada como alvo) e apagar
    `Concluido`. A ADR 0042 D4 PERMITE, porque continua havendo uma coluna
    `DONE` -- a trava e sobre a SEMANTICA existir, nao sobre a ponte.

    Antes do conserto de 11/08 a subconsulta da cascata devolvia NULL aqui, e
    `column_id` e NOT NULL desde a `0011`: concluir a mae explodia para quem
    clicou, num quadro que essa pessoa talvez nem conhecesse.
    """
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
    """⚠️ A ORDEM DOS DEGRAUS, DENTRO DA CASCATA.

    Duas colunas `DONE` no mesmo quadro: `Concluido` com ponte, e `Entregue`
    sem ponte e marcada como alvo. A ponte tem de ganhar, igual no repositorio.

    ⚠️ E O `DESC NULLS LAST` DA SUBCONSULTA. `legacy_status = 'COMPLETED'` e
    NULL -- e nao FALSE -- para `Entregue`, e o Postgres poe NULL primeiro num
    `DESC`. Sem o `NULLS LAST` a coluna sem ponte ganha, e a cascata manda as
    filhas para a coluna errada sem erro nenhum.
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
    """Duplicar passa pelo `create`, entao herda a regra da ADR 0042.

    ⚠️ NAO E REDUNDANTE com o teste de subtarefa da 5b-1: a duplicacao chama o
    `create` uma vez POR NO da arvore, e um erro de coluna aqui aparece so a
    partir do segundo nivel.
    """
    ctx, ws, raiz, user, quadro4 = await _mundo(db)
    mae, filha = await _mae_com_filha(db, ctx, ws, raiz, user, quadro4)

    # A filha vai para um status que o quadro de quatro colunas nao conhece.
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
