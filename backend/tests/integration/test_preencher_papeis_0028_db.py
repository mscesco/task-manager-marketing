"""Spec 054, fatia A -- o preenchimento dos PAPEIS dos avisos antigos (0028).

A migration roda UMA vez, sobre um banco vazio, quando a suite sobe -- entao o
`UPDATE` que reconstroi o papel dos avisos que ja existem nunca seria exercitado
antes da producao. Este arquivo o executa sobre dados montados.

O QUE PRENDE (D13, spec §6.3):
  - responsavel que tambem criou ganha os dois papeis, em ordem estavel;
  - seguidor ganha `watcher`;
  - ⚠️ aviso de PRAZO nao ganha `watcher` -- sem toggle de seguidor para ele, o
    papel o impediria de ser silenciado para sempre;
  - quem nao tem mais relacao nenhuma fica SEM papel (nunca silenciado);
  - tipo pessoal (mencao) e aviso sem tarefa nao sao tocados.

SABOTAGEM (medida): em `PREENCHER_PAPEIS`, apagar a condicao
`n.type NOT IN (...TIPOS_SEM_SEGUIDOR)`. Deve cair
`test_prazo_nao_ganha_seguidor`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.db.models import Notification
from tests.integration import factories as f

pytestmark = pytest.mark.integration

_ARQUIVO = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "0028_preferencias_de_notificacao.py"
)
_spec = importlib.util.spec_from_file_location("migration_0028", _ARQUIVO)
_modulo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_modulo)  # type: ignore[union-attr]
PREENCHER_PAPEIS: str = _modulo.PREENCHER_PAPEIS


async def _mundo(db):
    ws = await f.make_workspace(db)
    time = await f.make_team(db, workspace_id=ws)
    criadora = await f.make_user(db, workspace_id=ws)
    seguidora = await f.make_user(db, workspace_id=ws)
    sumida = await f.make_user(db, workspace_id=ws)
    for u in (criadora, seguidora, sumida):
        await f.add_member(db, workspace_id=ws, user_id=u, team_id=time, role="OPERATOR")
    tarefa = await f.make_task(db, workspace_id=ws, created_by=criadora, team_id=time)
    # A criadora tambem e responsavel; a seguidora segue E e responsavel.
    await f.make_assignment(
        db, workspace_id=ws, task_id=tarefa.id, user_id=criadora, assigned_by=criadora
    )
    await f.make_assignment(
        db, workspace_id=ws, task_id=tarefa.id, user_id=seguidora, assigned_by=criadora
    )
    await f.make_watcher(db, workspace_id=ws, task_id=tarefa.id, user_id=seguidora)
    return ws, tarefa, criadora, seguidora, sumida


async def _aviso(db, ws, *, para, tipo, tarefa):
    n = Notification(
        workspace_id=ws, recipient_id=para, actor_id=None, type=tipo,
        task_id=tarefa.id if tarefa is not None else None, payload={},
    )
    db.add(n)
    await db.flush()
    return n


async def _papeis(db, n) -> list[str]:
    await db.execute(text(PREENCHER_PAPEIS))
    return (
        await db.execute(select(Notification.roles).where(Notification.id == n.id))
    ).scalar_one()


async def test_responsavel_que_criou_ganha_os_dois(db) -> None:
    ws, tarefa, criadora, seguidora, sumida = await _mundo(db)
    n = await _aviso(db, ws, para=criadora, tipo="TASK_COMMENTED", tarefa=tarefa)
    assert await _papeis(db, n) == ["assignee", "creator"]


async def test_seguidor_ganha_watcher(db) -> None:
    ws, tarefa, criadora, seguidora, sumida = await _mundo(db)
    n = await _aviso(db, ws, para=seguidora, tipo="TASK_COLUMN_CHANGED", tarefa=tarefa)
    assert await _papeis(db, n) == ["watcher", "assignee"]


async def test_prazo_nao_ganha_seguidor(db) -> None:
    ws, tarefa, criadora, seguidora, sumida = await _mundo(db)
    n = await _aviso(db, ws, para=seguidora, tipo="TASK_DUE_SOON", tarefa=tarefa)
    assert await _papeis(db, n) == ["assignee"]


async def test_sem_relacao_fica_sem_papel(db) -> None:
    ws, tarefa, criadora, seguidora, sumida = await _mundo(db)
    n = await _aviso(db, ws, para=sumida, tipo="TASK_COMMENTED", tarefa=tarefa)
    assert await _papeis(db, n) == []


async def test_tipo_pessoal_e_aviso_sem_tarefa_nao_sao_tocados(db) -> None:
    ws, tarefa, criadora, seguidora, sumida = await _mundo(db)
    mencao = await _aviso(db, ws, para=criadora, tipo="TASK_MENTIONED", tarefa=tarefa)
    acesso = await _aviso(db, ws, para=criadora, tipo="ACCESS_LOST", tarefa=None)
    assert await _papeis(db, mencao) == []
    assert await _papeis(db, acesso) == []
