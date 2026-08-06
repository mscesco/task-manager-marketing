"""A tarefa grava QUADRO e COLUNA (Spec 035 fatia 3b, ADR 0033).

A fatia 3a fez o quadro nascer com o workspace. Esta faz a tarefa apontar para
ele -- e a `0011` trava os dois campos como obrigatorios.

⚠️ A DIRECAO E `status -> coluna`. Cada assercao aqui compara a coluna da
tarefa com o `legacy_status` dela, e nao com a semantica. Pela semantica o
teste passaria com a tarefa na coluna ERRADA: quatro colunas dividem
`IN_PROGRESS`, entao "esta numa coluna IN_PROGRESS" e verdade para Em
Andamento, Aprovação Interna, Aprovação Externa e Bloqueado ao mesmo tempo.
Afirmar a semantica seria afirmar quase nada -- a versao deste teste que
"passa mais facil" e a que nao mede.

O que defendem, em ordem:

  1. Tarefa nova nasce no quadro do time RAIZ, na coluna do seu status.
  2. Os OITO status tem coluna. E o que a inversao da D3 preserva -- pela
     regra original, quatro deles cairiam na mesma coluna.
  3. Mudar o status MOVE a coluna, e nao muda o quadro.
  4. A CASCATA de conclusao move a coluna dos descendentes. E o `UPDATE`
     textual em massa, que passa por fora do ORM -- o ponto mais facil de
     esquecer, e o que ja deixou `updated_at` velho por meses.
  5. Subtarefa de subtime vai para o quadro da RAIZ (ADR 0032), e nao para um
     quadro do subtime, que nao existe.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    admin = await f.make_user(db, workspace_id=ws)
    ana = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=admin, team_id=raiz, role="ADMIN"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=ana, team_id=sub, role="OPERATOR"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=admin, team_id=raiz
    )
    ctx = dict(
        workspace_id=ws,
        user_id=admin,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz), node(sub, raiz)),
    )
    return ws, raiz, sub, admin, ana, proj, ctx


async def _coluna_da_tarefa(db, task_id: uuid.UUID):
    """Do BANCO: `(board_id, column_id, legacy_status da coluna, status)`.

    ⚠️ Nao le o objeto em memoria. A cascata escreve por `UPDATE` textual, fora
    do identity map -- o atributo devolveria o valor velho e o teste passaria
    com o produto quebrado.
    """
    return (
        await db.execute(
            text(
                """
                SELECT t.board_id, t.column_id, c.legacy_status, t.status
                FROM task t
                LEFT JOIN board_column c ON c.id = t.column_id
                WHERE t.id = :i
                """
            ),
            {"i": task_id},
        )
    ).one()


async def _quadro_da_raiz(db, raiz: uuid.UUID):
    return (
        await db.execute(
            text("SELECT id FROM board WHERE team_id = :t AND is_default"),
            {"t": raiz},
        )
    ).scalar_one()


async def test_tarefa_nova_nasce_no_quadro_da_raiz_e_na_coluna_do_status(
    db,
) -> None:
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=raiz,
                assignee_ids=[admin],
            )
        )

    board_id, column_id, legacy, status = await _coluna_da_tarefa(db, t.id)
    assert board_id == await _quadro_da_raiz(db, raiz)
    assert column_id is not None
    assert legacy == status == TaskStatus.BACKLOG.value


@pytest.mark.parametrize("status", list(TaskStatus))
async def test_os_OITO_status_tem_coluna(db, status) -> None:
    """⚠️ O teste que a inversao da D3 existe para tornar possivel.

    Pela regra original (status derivado da semantica), `PLANNED`, `IN_REVIEW`,
    `EXTERNAL_APPROVAL` e `BLOCKED` cairiam todos na mesma coluna e o status
    voltaria diferente do que entrou.
    """
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title=f"Tarefa {status.value}",
                project_id=proj,
                team_id=raiz,
                status=status,
                assignee_ids=[admin],
            )
        )

    _board, column_id, legacy, gravado = await _coluna_da_tarefa(db, t.id)
    assert column_id is not None, f"{status.value} ficou sem coluna"
    assert gravado == status.value, "o status recebido nao pode ser trocado"
    assert legacy == status.value, (
        f"{status.value} foi parar na coluna de {legacy} -- a derivacao esta "
        "usando a semantica em vez do legacy_status (ADR 0033)"
    )


async def test_mudar_o_status_MOVE_a_coluna_e_nao_muda_o_quadro(db) -> None:
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=raiz,
                assignee_ids=[admin],
            )
        )
        antes = await _coluna_da_tarefa(db, t.id)

        await TaskService(db).update(
            task_id=t.id,
            command=UpdateTaskCommand(
                status=TaskStatus.EXTERNAL_APPROVAL,
                fields_set=frozenset({"status"}),
            ),
        )

    depois = await _coluna_da_tarefa(db, t.id)
    assert depois[0] == antes[0], "a tarefa nao muda de QUADRO ao mudar status"
    assert depois[1] != antes[1], "a coluna tem de mudar"
    assert depois[2] == TaskStatus.EXTERNAL_APPROVAL.value


async def test_cascata_de_conclusao_move_a_coluna_dos_DESCENDENTES(db) -> None:
    """⚠️ `UPDATE` textual em massa, por fora do ORM. Sem a subconsulta no SQL,
    a subarvore ficaria COMPLETED apontando para a coluna antiga -- estado
    inconsistente que a tela nao mostra hoje (o front desenha por status) e que
    apareceria como tarefa na coluna errada no dia em que o front ler o
    quadro."""
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        pai = await TaskService(db).create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=raiz,
                assignee_ids=[admin],
            )
        )
        filha = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça",
                project_id=proj,
                team_id=raiz,
                parent_task_id=pai.id,
                assignee_ids=[admin],
            )
        )
        neta = await TaskService(db).create(
            CreateTaskCommand(
                title="Corte",
                project_id=proj,
                team_id=raiz,
                parent_task_id=filha.id,
                assignee_ids=[admin],
            )
        )

        await TaskService(db).update(
            task_id=pai.id,
            command=UpdateTaskCommand(
                status=TaskStatus.COMPLETED,
                fields_set=frozenset({"status"}),
            ),
        )

    for tid, nome in ((filha.id, "subtarefa"), (neta.id, "neta")):
        _b, _c, legacy, status = await _coluna_da_tarefa(db, tid)
        assert status == TaskStatus.COMPLETED.value
        assert legacy == TaskStatus.COMPLETED.value, (
            f"a {nome} foi concluida pela cascata mas ficou na coluna de "
            f"{legacy}"
        )


async def test_tarefa_de_SUBTIME_vai_para_o_quadro_da_RAIZ(db) -> None:
    """ADR 0032: um quadro por workspace, do time raiz. Subtime nao tem quadro
    proprio -- ele tem a LENTE sobre o mesmo quadro. Se a resolucao usasse o
    time da tarefa, a tarefa do subtime nao acharia quadro nenhum e a criacao
    falharia."""
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="Peça do Design",
                project_id=proj,
                team_id=sub,
                assignee_ids=[ana],
            )
        )

    board_id, column_id, _legacy, _status = await _coluna_da_tarefa(db, t.id)
    assert board_id == await _quadro_da_raiz(db, raiz)
    assert column_id is not None

    n = (
        await db.execute(
            text("SELECT count(*) FROM board WHERE team_id = :t"), {"t": sub}
        )
    ).scalar_one()
    assert n == 0, "subtime nao ganha quadro por existir (ADR 0032)"


async def test_a_coluna_e_sempre_do_MESMO_quadro_da_tarefa(db) -> None:
    """A FK composta `(column_id, board_id)` promete isso no banco. Medido
    assim mesmo: constraint que ninguem testou e promessa."""
    ws, raiz, sub, admin, ana, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        for status in (TaskStatus.BACKLOG, TaskStatus.BLOCKED):
            await TaskService(db).create(
                CreateTaskCommand(
                    title=f"T {status.value}",
                    project_id=proj,
                    team_id=raiz,
                    status=status,
                    assignee_ids=[admin],
                )
            )

    fora = (
        await db.execute(
            text(
                """
                SELECT count(*) FROM task t
                JOIN board_column c ON c.id = t.column_id
                WHERE c.board_id <> t.board_id
                """
            )
        )
    ).scalar_one()
    assert fora == 0
