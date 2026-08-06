"""F1a -- o aviso de prazo passa a ler a COLUNA (ADR 0030, Spec 035 D-flag).

Contra Postgres real. Mesmo relogio do `test_deadline_notify_db.py`: NOW fixo
12:00 UTC = 09:00 America/Sao_Paulo, entao "hoje" local = 2026-06-25.

O que estes casos afirmam e o que o teste velho nao conseguia afirmar: quem
decide o aviso e a COLUNA em que a tarefa esta, e nao o `status` dela.

⚠️ SEGUNDA VERSAO. A primeira tinha DOIS testes cegos: o caso 2 ligava uma flag
que ja nascia ligada e o caso 3 e excluido pela semantica antes de a flag
importar -- os dois passariam com o helper `_set_notify_deadline` sem fazer
nada. Sobrou um unico caso exercitando o helper, e foi o unico que caiu. As
travas contra isso agora estao no proprio helper (`rowcount`) e nos casos 1 e
3 (conferencia de leitura antes de rodar a varredura).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select, update

from app.db.models import BoardColumn, Task
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from tests.integration import factories as f

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
OVERDUE = date(2026, 6, 24)  # ontem


async def _ws(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    return ws, team, user


async def _task_vencida(db, *, ws, team, user, status, title):
    """Tarefa com prazo vencido, NA COLUNA que corresponde ao `status`.

    ⚠️ `status=` vai na FACTORY, nao atribuido depois. A factory resolve a
    coluna a partir do status no momento da criacao; atribuir `t.status` depois
    deixa a tarefa na coluna do status ANTIGO, e desde esta fatia e a coluna
    que decide o aviso.
    """
    t = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=team,
        title=title,
        status=status,
    )
    t.due_date = OVERDUE
    return t


async def _set_notify_deadline(db, *, ws, legacy_status, valor: bool) -> None:
    """Liga/desliga a cobranca de prazo NA COLUNA daquele status.

    ⚠️ `update()` do ORM com `synchronize_session="fetch"`, e nao `text()` cru.
    A versao com SQL cru deixou o caso 1 vermelho: os objetos `BoardColumn` ja
    estao na sessao (o `BoardService` os criou via ORM durante o `make_team`),
    e um UPDATE textual muda a linha sem a sessao saber. O `fetch` e o que
    mantem os dois lados iguais.

    ⚠️ O `assert` de `rowcount` existe porque helper de fixture que nao faz
    nada e invisivel: os casos 2 e 3 passariam do mesmo jeito. Sem esta linha,
    a suite ficaria verde afirmando menos do que promete.
    """
    r = await db.execute(
        update(BoardColumn)
        .where(
            BoardColumn.workspace_id == ws,
            BoardColumn.legacy_status == legacy_status,
        )
        .values(notify_deadline=valor)
        .execution_options(synchronize_session="fetch")
    )
    assert r.rowcount == 1, (
        f"o UPDATE da flag pegou {r.rowcount} linhas, esperava 1 "
        f"(workspace={ws}, legacy_status={legacy_status})"
    )


async def _coluna_da_tarefa(db, task_id):
    """`(notify_deadline, semantic)` da coluna onde a tarefa esta, lido do BANCO."""
    return (
        await db.execute(
            select(BoardColumn.notify_deadline, BoardColumn.semantic)
            .join(Task, Task.column_id == BoardColumn.id)
            .where(Task.id == task_id)
        )
    ).first()


# 1 -- coluna que NAO cobra prazo nao avisa, mesmo com a tarefa viva e vencida.
#      E a promessa da ADR 0030 que ainda nao tinha sido entregue: um time cria
#      "Aguardando cliente" e desliga a cobranca SEM CODIGO NOVO. Aqui a coluna
#      "Em Andamento" faz o papel dela.
#
#      ⚠️ A conferencia de leitura no meio separa os dois defeitos possiveis:
#      se ELA falhar, o problema e o helper (a flag nao chegou no banco); se
#      ela passar e a asercao final falhar, o problema e a query do servico.
async def test_coluna_sem_cobranca_nao_avisa(db) -> None:
    ws, team, user = await _ws(db)
    t = await _task_vencida(
        db, ws=ws, team=team, user=user, status=TaskStatus.IN_PROGRESS, title="a"
    )
    await _set_notify_deadline(
        db, ws=ws, legacy_status=TaskStatus.IN_PROGRESS, valor=False
    )
    await db.flush()

    assert await _coluna_da_tarefa(db, t.id) == (
        False,
        ColumnSemantic.IN_PROGRESS,
    )

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 0


# 2 -- a MESMA tarefa, com a flag ligada, avisa. O par com o caso 1 e o que
#      prova que quem decidiu foi a FLAG e nao o status `IN_PROGRESS`.
#
#      ⚠️ Este caso e VACUO sozinho: a coluna ja nasce com a flag ligada, entao
#      ele passaria mesmo com o helper quebrado. So vale ao lado do caso 1, e e
#      por isso que o `rowcount` mora no helper e nao aqui.
async def test_a_mesma_tarefa_com_a_flag_ligada_avisa(db) -> None:
    ws, team, user = await _ws(db)
    await _task_vencida(
        db, ws=ws, team=team, user=user, status=TaskStatus.IN_PROGRESS, title="a"
    )
    await _set_notify_deadline(
        db, ws=ws, legacy_status=TaskStatus.IN_PROGRESS, valor=True
    )
    await db.flush()

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 1


# 3 -- coluna terminal nao avisa NEM COM A FLAG LIGADA.
#      E o caso das 136 tarefas em `Concluido` com prazo vencido, medidas em
#      producao em 06/08. `Concluido` e `Cancelado` nascem com
#      `notify_deadline=True` nos defaults; quem trocasse a lista cravada pela
#      flag crua dispararia 136 avisos falsos na primeira madrugada.
async def test_coluna_terminal_nao_avisa_mesmo_com_a_flag_ligada(db) -> None:
    ws, team, user = await _ws(db)
    concluida = await _task_vencida(
        db, ws=ws, team=team, user=user, status=TaskStatus.COMPLETED, title="c"
    )
    await _task_vencida(
        db, ws=ws, team=team, user=user, status=TaskStatus.CANCELLED, title="x"
    )
    await _set_notify_deadline(
        db, ws=ws, legacy_status=TaskStatus.COMPLETED, valor=True
    )
    await _set_notify_deadline(
        db, ws=ws, legacy_status=TaskStatus.CANCELLED, valor=True
    )
    await db.flush()

    # A premissa do caso: a coluna terminal esta MESMO cobrando prazo, e ainda
    # assim nao avisa. Sem esta linha o teste passaria por qualquer motivo.
    assert await _coluna_da_tarefa(db, concluida.id) == (
        True,
        ColumnSemantic.DONE,
    )

    r = await DeadlineNotifyService(db).run(now=NOW)
    assert r["overdue_count"] == 0
