"""Spec 054, fatia B -- a emissao grava POR QUE o aviso chegou (`roles`).

O papel e o que a tela de preferencias (fatia C) usa para silenciar: desligar
"comentario / como seguidor" tem de achar exatamente os avisos que chegaram
PORQUE a pessoa segue. Se a emissao nao gravar, ou gravar o papel errado, o
toggle vira sorteio -- e como o silencio vale na LEITURA, o erro so apareceria
meses depois, num aviso que nao suma quando ela desliga.

O QUE ESTE ARQUIVO PRENDE:
  - cada destinatario leva OS SEUS papeis (seguidor, responsavel, criador), e
    quem tem dois leva os dois (D12);
  - ⚠️ NA JUNCAO OS PAPEIS SE UNEM (§6.2): a pessoa pode deixar de seguir e
    virar responsavel entre o primeiro aviso e o segundo; perder o papel antigo
    faria o aviso juntado -- que conta as DUAS mudancas -- ser silenciado por um
    toggle que nao cobre tudo o que ele diz;
  - tipo PESSOAL (mencao) nasce sem papel, e sem papel nunca e silenciado (D13);
  - ⚠️ PRAZO nao ganha `watcher` NUNCA (a tela nao tem esse toggle para ele):
    responsavel quando ha responsavel ativo, criador na reserva.

SABOTAGENS (medidas):
  A. Em `NotificationRepository.atualizar`, gravar `roles=list(roles)` em vez da
     uniao com `row.roles`. Deve cair `test_a_juncao_une_os_papeis`.
  B. Em `DeadlineNotifyService._recipients`, devolver `"watcher"` no lugar de
     `"assignee"`. Deve cair `test_prazo_grava_responsavel_e_nunca_seguidor`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select, text

from app.db.models import Notification
from app.db.models.enums import TaskStatus
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from tests.integration import factories as f
from tests.integration.test_avisos_de_mudanca_053c_db import _cliente, _setup

pytestmark = pytest.mark.integration

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
SOON = date(2026, 6, 27)  # hoje + 2 -> due_soon


async def _papeis(db, recipient, tipo, *, task_id=None) -> list[list[str]]:
    """Os `roles` de cada aviso de um tipo para uma pessoa.

    ⚠️ `populate_existing`: a rota ja carregou estas linhas na sessao, e sem
    isto o SELECT devolveria o `roles` de antes da juncao.
    """
    stmt = select(Notification).where(
        Notification.recipient_id == recipient, Notification.type == tipo
    )
    if task_id is not None:
        stmt = stmt.where(Notification.task_id == task_id)
    rows = (
        (await db.execute(stmt.execution_options(populate_existing=True)))
        .scalars()
        .all()
    )
    return [list(r.roles or []) for r in rows]


def _url(c) -> str:
    return f"/api/v1/tasks/{c['tarefa'].id}"


# ------------------------------------------------- o papel de cada destinatario
async def test_mover_de_coluna_grava_o_papel_de_cada_um(db) -> None:
    """Os tres papeis no mesmo gesto: `op` segue, `resp` e responsavel, `adm`
    criou. Um aviso so para cada, e cada um com o SEU papel."""
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            _url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)}
        )
    assert r.status_code == 200, r.text

    assert await _papeis(db, c["op"], "TASK_COLUMN_CHANGED") == [["watcher"]]
    assert await _papeis(db, c["resp"], "TASK_COLUMN_CHANGED") == [["assignee"]]
    assert await _papeis(db, c["adm"], "TASK_COLUMN_CHANGED") == [["creator"]]


async def test_quem_tem_dois_papeis_leva_os_dois(db) -> None:
    """`resp` tambem passa a seguir: um aviso so, com os dois papeis.

    Nao e detalhe: com a preferencia lida por papel (D4), silenciar exige que
    TODOS os papeis do aviso estejam desligados. Gravar so um deles faria o
    aviso desaparecer para quem desligou apenas aquele.
    """
    c = await _setup(db)
    await f.make_watcher(
        db, workspace_id=c["ws"], task_id=c["tarefa"].id, user_id=c["resp"]
    )
    await db.commit()
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            _url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)}
        )
    assert r.status_code == 200, r.text

    assert await _papeis(db, c["resp"], "TASK_COLUMN_CHANGED") == [
        ["watcher", "assignee"]
    ]


async def test_a_juncao_une_os_papeis(db) -> None:
    """⚠️ O GUARDIAO DA UNIAO (§6.2).

    `op` segue quando o primeiro aviso sai, deixa de seguir, vira responsavel, e
    ai vem a segunda mudanca -- que JUNTA no mesmo aviso ("Backlog para
    Cancelado"). O aviso resultante conta as duas mudancas, entao carrega os
    dois papeis. Sem a uniao ficaria so `assignee`, e desligar "mudanca de
    coluna / como responsavel" esconderia tambem a parte que ela recebeu por
    seguir.
    """
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r1 = await cli.patch(
            _url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)}
        )
        assert r1.status_code == 200, r1.text
        assert await _papeis(db, c["op"], "TASK_COLUMN_CHANGED") == [["watcher"]]

        # deixa de seguir e vira responsavel, ANTES da segunda mudanca
        await db.execute(
            text("DELETE FROM task_watcher WHERE task_id=:t AND user_id=:u"),
            {"t": c["tarefa"].id, "u": c["op"]},
        )
        await f.make_assignment(
            db,
            workspace_id=c["ws"],
            task_id=c["tarefa"].id,
            user_id=c["op"],
            assigned_by=c["adm"],
        )
        await db.commit()

        r2 = await cli.patch(
            _url(c), json={"column_id": str(c["colunas"]["Cancelado"].id)}
        )
        assert r2.status_code == 200, r2.text

    avisos = await _papeis(db, c["op"], "TASK_COLUMN_CHANGED")
    assert avisos == [["watcher", "assignee"]]


# --------------------------------------------------------------- comentario
async def test_comentario_grava_o_papel(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.post(f"{_url(c)}/comments", json={"content": "olha isso"})
    assert r.status_code == 201, r.text

    assert await _papeis(db, c["op"], "TASK_COMMENTED") == [["watcher"]]
    assert await _papeis(db, c["resp"], "TASK_COMMENTED") == [["assignee"]]
    assert await _papeis(db, c["adm"], "TASK_COMMENTED") == [["creator"]]


async def test_mencao_nasce_sem_papel(db) -> None:
    """Mencao e PESSOAL (D13): chega porque escreveram o nome da pessoa, nao
    porque ela segue. Vazio, e vazio nunca e silenciado por toggle de papel --
    e por isso que a tela trava essa linha.

    `op` SEGUE a tarefa e mesmo assim o aviso dele sai sem papel: o mencionado
    fica de fora do fan-out de comentario e recebe so a mencao.
    """
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            f"{_url(c)}/comments",
            json={"content": f"@[Op]({c['op']}) olha isso"},
        )
    assert r.status_code == 201, r.text

    assert await _papeis(db, c["op"], "TASK_MENTIONED") == [[]]
    assert await _papeis(db, c["op"], "TASK_COMMENTED") == []


# --------------------------------------------------------------------- prazo
async def _mundo_de_prazo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    criador = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=criador, team_id=team, role="ADMIN")
    tarefa = await f.make_task(
        db,
        workspace_id=ws,
        created_by=criador,
        team_id=team,
        title="Prazo",
        status=TaskStatus.BACKLOG,
    )
    tarefa.due_date = SOON
    return ws, team, criador, tarefa


async def test_prazo_grava_responsavel_e_nunca_seguidor(db) -> None:
    """⚠️ Prazo chegando vai para o RESPONSAVEL, e o papel gravado e
    `assignee` -- nunca `watcher`, mesmo que a pessoa tambem siga a tarefa.

    A tela de preferencias nao tem coluna de seguidor para os avisos de prazo
    (§5): com `watcher` no conjunto, um aviso de prazo ficaria impossivel de
    silenciar, porque o silencio exige TODO papel desligado (D4).
    """
    ws, team, criador, tarefa = await _mundo_de_prazo(db)
    resp = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=resp, team_id=team, role="OPERATOR")
    await f.make_assignment(
        db, workspace_id=ws, task_id=tarefa.id, user_id=resp, assigned_by=criador
    )
    await f.make_watcher(db, workspace_id=ws, task_id=tarefa.id, user_id=resp)
    await db.flush()

    assert (await DeadlineNotifyService(db).run(now=NOW))["due_soon_count"] == 1

    assert await _papeis(db, resp, "TASK_DUE_SOON", task_id=tarefa.id) == [["assignee"]]
    # o criador nao recebe quando ha responsavel ativo (Spec 023)
    assert await _papeis(db, criador, "TASK_DUE_SOON", task_id=tarefa.id) == []


async def test_prazo_sem_responsavel_grava_criador(db) -> None:
    """A reserva da Spec 023: sem responsavel ativo, o aviso vai para quem
    criou -- e o papel e `creator`, o toggle que a tela oferece."""
    ws, team, criador, tarefa = await _mundo_de_prazo(db)
    await db.flush()

    assert (await DeadlineNotifyService(db).run(now=NOW))["due_soon_count"] == 1

    assert await _papeis(db, criador, "TASK_DUE_SOON", task_id=tarefa.id) == [
        ["creator"]
    ]
