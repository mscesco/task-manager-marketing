"""A limpeza diaria das notificacoes (auditoria de 11/11, item 17).

Apaga o aviso JA LIDO cuja ultima mudanca (`updated_at`, a mesma data que o
sino mostra) tem mais de 6 meses. Nao lido nunca e apagado, por mais velho que
seja: a pessoa ainda nao o viu. Decisao da Camila em 11/11.

⚠️ RODA FORA DE CONTEXTO DE TENANT, de proposito: e uma rota de maquina
(`POST /system/notifications/purge`, `X-System-Token`), chamada pelo n8n, que
varre TODOS os workspaces -- como o `bases/purge`. Por isso nao passa pelo
`NotificationRepository`, que exige tenant.

Idempotente: rodar duas vezes no dia apaga nada na segunda.
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
