"""Limpeza diaria: apaga avisos lidos cuja ultima mudanca tem mais de 6 meses.

Nao lido nunca e apagado. Roda fora de contexto de tenant (rota de sistema que
varre todos os workspaces), por isso nao usa o `NotificationRepository`.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import Notification

logger = get_logger(__name__)

#: Quanto tempo um aviso lido fica guardado.
READ_RETENTION = timedelta(days=180)


class NotificationPurgeService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict[str, int]:
        r = await self._session.execute(
            delete(Notification).where(
                Notification.read_at.is_not(None),
                Notification.updated_at < now - READ_RETENTION,
            )
        )
        resultado = {"notifications": int(r.rowcount or 0)}
        await self._session.commit()
        logger.info("notification.purge.done", **resultado)
        return resultado
