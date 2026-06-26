"""Emissor de notificacoes (Spec 018) -- PONTO UNICO DE EMISSAO.

Os services que disparam eventos (designar responsavel, comentar)
instanciam um `NotificationEmitter(session)` e chamam UM metodo por tipo
de evento. Nada de `if` de notificacao espalhado pelos services: cada
tipo novo no futuro = um metodo novo aqui, chamado de um lugar so.

Compartilha a `session` do service -> a notificacao entra na MESMA
transacao do evento (commit junto, rollback junto; sem fantasma).

Snapshot de exibicao (D1): no momento da emissao gravamos
`{actor_name, task_title}` no payload. O read fica barato (scan de 1
tabela) ao custo de o titulo ficar "congelado" se a task for renomeada
-- aceitavel para um feed de eventos historicos.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.tenant import require_tenant
from app.db.models import User
from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)


class NotificationEmitter:
    """Emite notificacoes para os eventos do dominio. Nao comita."""

    def __init__(self, session) -> None:
        self._session = session
        self._repo = NotificationRepository(session)

    async def task_assigned(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Notifica o designado de que virou responsavel pela task.

        No-op se o ator designou a si mesmo (nao faz sentido se notificar).
        """
        if recipient_id == actor_id:
            return
        self._repo.create(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type=NotificationType.TASK_ASSIGNED.value,
            task_id=task_id,
            payload={
                "actor_name": await self._actor_name(actor_id),
                "task_title": task_title,
            },
        )

    async def _actor_name(self, actor_id: uuid.UUID) -> str:
        """Nome do ator (snapshot), escopado ao tenant. '' se nao achar."""
        stmt = select(User.name).where(
            User.id == actor_id,
            User.workspace_id == require_tenant().workspace_id,
        )
        name = (await self._session.execute(stmt)).scalar_one_or_none()
        return name or ""
