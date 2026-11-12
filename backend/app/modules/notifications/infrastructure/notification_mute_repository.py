"""Acesso a `notification_mute`: uma linha = um toggle desligado; ausencia = ligado.

Sempre do usuario logado (nenhum metodo recebe `user_id`). Nunca comita.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.core.tenant import require_tenant
from app.db.models import NotificationMute
from app.db.repository import BaseRepository


class NotificationMuteRepository(BaseRepository[NotificationMute]):
    """Os toggles desligados do usuario logado."""

    model = NotificationMute

    async def desligados(self) -> set[tuple[str, str]]:
        """Os pares `(tipo, papel)` desligados de quem esta lendo."""
        tenant = require_tenant()
        rows = await self.session.execute(
            select(NotificationMute.type, NotificationMute.role).where(
                NotificationMute.workspace_id == tenant.workspace_id,
                NotificationMute.user_id == tenant.user_id,
            )
        )
        return {(t, r) for t, r in rows.all()}

    async def desligar(self, *, tipos: tuple[str, ...], role: str) -> None:
        """Desliga o toggle: uma linha por tipo do grupo.

        `ON CONFLICT DO NOTHING` em vez de SELECT antes: dois cliques quase
        juntos cairiam entre o SELECT e o INSERT.
        """
        tenant = require_tenant()
        await self.session.execute(
            insert(NotificationMute)
            .values(
                [
                    {
                        "workspace_id": tenant.workspace_id,
                        "user_id": tenant.user_id,
                        "type": tipo,
                        "role": role,
                    }
                    for tipo in tipos
                ]
            )
            .on_conflict_do_nothing(
                constraint="uq_notification_mute_user_type_role"
            )
        )

    async def ligar(self, *, tipos: tuple[str, ...], role: str) -> None:
        """Liga o toggle: apaga as linhas do grupo (idempotente)."""
        tenant = require_tenant()
        await self.session.execute(
            delete(NotificationMute).where(
                NotificationMute.workspace_id == tenant.workspace_id,
                NotificationMute.user_id == tenant.user_id,
                NotificationMute.type.in_(tipos),
                NotificationMute.role == role,
            )
        )
