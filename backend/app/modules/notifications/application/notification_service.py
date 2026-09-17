"""Casos de uso de LEITURA de notificacoes (Spec 018, F4).

Camada fina sobre o repository: pagina o feed, conta nao-lidas, marca
lida (1 ou todas). A escrita (emissao) NAO vive aqui -- vive no
NotificationEmitter, chamado pelos services de dominio. Commit no UoW
(router).

Tudo e PESSOAL: o repository ja filtra por recipient == usuario logado.
Marcar uma notificacao que nao e sua -> EntityNotFoundError (404).
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.domain.notification import NotificationDTO
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)
from app.shared.exceptions.base import EntityNotFoundError
from app.shared.pagination import Page, PageParams


class NotificationService:
    """Leitura e marcacao de notificacoes do usuario logado."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = NotificationRepository(session)

    async def list_for_me(
        self, params: PageParams, *, unread_only: bool = False
    ) -> Page[NotificationDTO]:
        page = await self._repo.list_for_me(params=params, unread_only=unread_only)
        return Page(
            items=[self._to_dto(row) for row in page.items],
            total=page.total,
            page=page.page,
            size=page.size,
        )

    async def count_unread(self) -> int:
        return await self._repo.count_unread()

    async def mark_read(self, notification_id: uuid.UUID) -> None:
        """Marca uma notificacao do usuario como lida. 404 se nao e dele."""
        ok = await self._repo.mark_read(notification_id)
        if not ok:
            raise EntityNotFoundError("Notification", identifier=notification_id)

    async def mark_all_read(self) -> int:
        """Marca todas as nao-lidas do usuario. Retorna quantas."""
        return await self._repo.mark_all_read()

    @staticmethod
    def _to_dto(row) -> NotificationDTO:
        return NotificationDTO(
            id=row.id,
            type=row.type,
            actor_id=row.actor_id,
            task_id=row.task_id,
            comment_id=row.comment_id,
            payload=row.payload,
            read_at=row.read_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
