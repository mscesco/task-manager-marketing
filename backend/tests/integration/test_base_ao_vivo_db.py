"""Spec 056, fatia G -- o ao vivo: LISTEN/NOTIFY de verdade, entre conexoes.

⚠️⚠️ ESTE ARQUIVO NAO USA A SESSAO DE TESTE (`db`) para o aviso, e e de
proposito: a sessao de teste vive numa transacao que VOLTA no fim, e o
Postgres so entrega o NOTIFY no COMMIT -- nada chegaria. Aqui sao duas
conexoes asyncpg proprias, uma escutando (o `LiveHub`) e outra avisando,
exatamente como dois workers da API.

O que fica provado:
    - o aviso atravessa conexoes (o motivo de usar o Postgres, spec §10.2);
    - so sai no COMMIT; transacao que volta nao avisa ninguem;
    - cada base recebe so os seus; sair da fila para de receber;
    - toda acao do diario chama `publicar` (um lugar so).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import asyncpg
import pytest

from app.modules.bases.application import journal
from app.modules.bases.application.row_service import CellWrite, RowService
from app.modules.bases.infrastructure.live import CANAL, LiveHub
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


def _dsn() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("sem TEST_DATABASE_URL")
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def _hub() -> LiveHub:
    async def conectar():
        pg = await asyncpg.connect(_dsn())
        return pg, pg.close

    return LiveHub(conectar=conectar)


async def _avisar(base_id: uuid.UUID, *, commit: bool = True) -> None:
    pg = await asyncpg.connect(_dsn())
    try:
        tx = pg.transaction()
        await tx.start()
        await pg.execute(
            "SELECT pg_notify($1, $2)",
            CANAL,
            json.dumps({"base_id": str(base_id), "kind": "cell.update", "actor_id": "u"}),
        )
        await (tx.commit() if commit else tx.rollback())
    finally:
        await pg.close()


async def _proximo(fila: asyncio.Queue, segundos: float = 3.0):
    return await asyncio.wait_for(fila.get(), timeout=segundos)


async def test_o_aviso_atravessa_conexoes() -> None:
    hub = await _hub()
    base = uuid.uuid4()
    try:
        fila = await hub.subscribe(base)
        await _avisar(base)
        aviso = await _proximo(fila)
        assert aviso == {"base_id": str(base), "kind": "cell.update", "actor_id": "u"}
    finally:
        await hub.close()


async def test_transacao_que_volta_nao_avisa() -> None:
    hub = await _hub()
    base = uuid.uuid4()
    try:
        fila = await hub.subscribe(base)
        await _avisar(base, commit=False)
        with pytest.raises(TimeoutError):
            await _proximo(fila, 0.5)
    finally:
        await hub.close()


async def test_cada_base_recebe_so_os_seus_e_sair_para_de_receber() -> None:
    hub = await _hub()
    a, b = uuid.uuid4(), uuid.uuid4()
    try:
        fila_a = await hub.subscribe(a)
        fila_b = await hub.subscribe(b)
        await _avisar(b)
        assert (await _proximo(fila_b))["base_id"] == str(b)
        assert fila_a.empty()

        hub.unsubscribe(b, fila_b)
        await _avisar(b)
        await asyncio.sleep(0.3)
        assert fila_b.empty()
    finally:
        await hub.close()


async def test_a_escuta_reabre_depois_de_cair() -> None:
    """A conexao de escuta caiu (reinicio do banco, rede): o proximo
    `subscribe` reabre -- e os canais vencem em 60 s e se reinscrevem."""
    hub = await _hub()
    base = uuid.uuid4()
    try:
        await hub.subscribe(base)
        await hub._pg.close()  # simula a queda
        await asyncio.sleep(0.1)
        fila = await hub.subscribe(base)
        await _avisar(base)
        assert (await _proximo(fila))["base_id"] == str(base)
    finally:
        await hub.close()


async def test_toda_acao_do_diario_publica(db, monkeypatch) -> None:
    """Um lugar so publica (`journal.record`), para nenhuma acao esquecer."""
    chamadas: list[tuple[str, str]] = []

    async def espiao(_session, base_id, kind, _actor):
        chamadas.append((str(base_id), kind))

    monkeypatch.setattr(journal, "publicar", espiao)
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=mkt, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=op, team_id=mkt)
    with acting_as(
        workspace_id=ws, user_id=op, memberships=(mship(mkt, "OPERATOR"),), team_tree=(node(mkt),)
    ):
        await RowService(db).update_cells(
            base["base"], [CellWrite(base["linha"], base["titulo"], "Novo")]
        )
    assert chamadas == [(str(base["base"]), "cell.update")]
