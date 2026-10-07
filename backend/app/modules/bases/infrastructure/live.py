"""O ao vivo da Base (Spec 056, fatia G, §10): avisar quem esta com a base
aberta que ela mudou.

    gravacao -> `publicar()` -> NOTIFY base_events  (dentro da transacao)
             -> o Postgres entrega no COMMIT, a todos os que escutam
    cada worker da API -> UMA conexao com LISTEN (`LiveHub`)
             -> fila de cada navegador com aquela base aberta -> SSE

⚠️⚠️ POR QUE O POSTGRES, E NAO UMA FILA NA MEMORIA: a API roda com 2 workers
(`entrypoint.sh`). A gravacao cai num e o navegador pode estar ouvindo no
outro. O `LISTEN/NOTIFY` do proprio banco atravessa os dois sem servico novo
(sem Redis).

⚠️⚠️ O AVISO NAO LEVA OS DADOS, so `{base_id, kind, actor_id}` -- quem recebe
recarrega a base. O `NOTIFY` tem teto de 8.000 bytes por mensagem, e uma
celula de texto pode ter 5.000 caracteres; mandar o estado novo exigiria um
segundo caminho para o que nao cabe. Recarregar e um caminho so, e nunca fica
pela metade. (Desvio registrado na spec §10.3.)

⚠️ E SO SAI NO COMMIT: o `pg_notify` dentro da transacao e entregue quando ela
confirma, e some se ela voltar. Ninguem e avisado de uma gravacao que nao
aconteceu.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)

CANAL = "base_events"

#: Quantos avisos uma conexao acumula sem ler antes de comecar a perder os
#: mais novos. Perder e inofensivo: qualquer aviso faz recarregar tudo.
FILA_MAX = 50


async def publicar(
    session: AsyncSession, base_id: uuid.UUID, kind: str, actor_id: uuid.UUID
) -> None:
    """Avisa, NO COMMIT desta transacao, que a base mudou."""
    payload = json.dumps(
        {"base_id": str(base_id), "kind": kind, "actor_id": str(actor_id)}
    )
    await session.execute(
        text("SELECT pg_notify(:canal, :payload)"),
        {"canal": CANAL, "payload": payload},
    )


#: Abre a conexao crua (asyncpg) que fica escutando. Devolve a conexao e uma
#: funcao para devolve-la quando o hub fechar.
Conectar = Callable[[], Awaitable[tuple[Any, Callable[[], Awaitable[None]]]]]


async def _conectar_pelo_pool() -> tuple[Any, Callable[[], Awaitable[None]]]:
    """A conexao de escuta sai do MESMO pool da app (mesmo DSN, mesmo SSL),
    e fica com ela enquanto o worker viver: UMA por worker, nao por navegador."""
    from app.db.session import db_manager

    conexao = await db_manager.engine.connect()
    crua = await conexao.get_raw_connection()
    return crua.driver_connection, conexao.close


class LiveHub:
    """As filas de quem esta com cada base aberta, neste worker."""

    def __init__(self, conectar: Conectar = _conectar_pelo_pool) -> None:
        self._conectar = conectar
        self._filas: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._pg: Any = None
        self._fechar: Callable[[], Awaitable[None]] | None = None
        self._trava = asyncio.Lock()

    async def subscribe(self, base_id: uuid.UUID) -> asyncio.Queue[dict[str, Any]]:
        await self._garantir_escuta()
        fila: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=FILA_MAX)
        self._filas.setdefault(str(base_id), set()).add(fila)
        return fila

    def unsubscribe(self, base_id: uuid.UUID, fila: asyncio.Queue[dict[str, Any]]) -> None:
        filas = self._filas.get(str(base_id))
        if filas is None:
            return
        filas.discard(fila)
        if not filas:
            del self._filas[str(base_id)]

    async def close(self) -> None:
        async with self._trava:
            await self._soltar()

    # ------------------------------------------------------------ escuta
    async def _garantir_escuta(self) -> None:
        async with self._trava:
            if self._pg is not None and not self._pg.is_closed():
                return
            await self._soltar()
            self._pg, self._fechar = await self._conectar()
            await self._pg.add_listener(CANAL, self._ao_avisar)
            # Caiu a conexao: esquece; o proximo `subscribe` reabre. Os canais
            # abertos vencem em 60 s e reconectam -- e ai reabrem a escuta.
            self._pg.add_termination_listener(lambda _c: self._esquecer())
            logger.info("base.live.listening")

    def _esquecer(self) -> None:
        self._pg = None
        self._fechar = None
        logger.warning("base.live.connection_lost")

    async def _soltar(self) -> None:
        pg, fechar = self._pg, self._fechar
        self._pg = None
        self._fechar = None
        if pg is not None and not pg.is_closed():
            with contextlib.suppress(Exception):
                await pg.remove_listener(CANAL, self._ao_avisar)
        if fechar is not None:
            with contextlib.suppress(Exception):
                await fechar()

    def _ao_avisar(self, _conexao: Any, _pid: int, _canal: str, payload: str) -> None:
        try:
            aviso = json.loads(payload)
        except ValueError:
            return
        for fila in self._filas.get(str(aviso.get("base_id")), ()):
            # Fila cheia: quem nao esta lendo perde avisos -- inofensivo,
            # porque um aviso so ja faz recarregar tudo.
            with contextlib.suppress(asyncio.QueueFull):
                fila.put_nowait(aviso)


#: Um por worker.
hub = LiveHub()
