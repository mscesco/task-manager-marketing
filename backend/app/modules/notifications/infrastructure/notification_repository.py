"""Repository de notificacoes (Spec 018, F1).

Herda BaseRepository -> filtro automatico de workspace via `_base_select`.
Notificacao e PESSOAL: alem do tenant, as leituras e as marcacoes filtram
por `recipient_id == usuario logado` (require_tenant().user_id). Sem
soft-delete. O repository NUNCA comita (UoW no router).
"""

from __future__ import annotations

import uuid

from datetime import timedelta

from sqlalchemy import delete, func, select, update

from app.core.tenant import require_tenant
from app.db.models import Notification
from app.db.repository import BaseRepository
from app.shared.pagination import Page, PageParams


class NotificationRepository(BaseRepository[Notification]):
    """Acesso a dados de notificacoes, escopado ao tenant + recipient."""

    model = Notification

    def create(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID | None,
        type: str,
        task_id: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
        payload: dict | None = None,
    ) -> Notification:
        """Registra uma notificacao na sessao (sem commit)."""
        tenant = require_tenant()
        row = Notification(
            workspace_id=tenant.workspace_id,
            recipient_id=recipient_id,
            actor_id=actor_id,
            type=type,
            task_id=task_id,
            comment_id=comment_id,
            payload=payload,
        )
        self.session.add(row)
        return row

    async def list_for_me(
        self, *, params: PageParams, unread_only: bool = False
    ) -> Page[Notification]:
        """Feed do usuario logado, mais novas primeiro (desempate por id).

        O filtro de workspace ja vem do `_base_select`; aqui somamos o
        recorte por recipient. Desempate por `id` porque func.now() e
        constante na transacao (created_at pode empatar -- mesmo
        aprendizado dos comentarios).
        """
        me = require_tenant().user_id
        base = self._base_select().where(Notification.recipient_id == me)
        if unread_only:
            base = base.where(Notification.read_at.is_(None))

        total = (
            await self.session.execute(
                select(func.count()).select_from(base.subquery())
            )
        ).scalar_one()

        stmt = (
            # ⚠️ `updated_at`, e nao `created_at`, desde a Spec 053 (C): o
            # aviso que juntou uma mudanca nova sobe para o topo.
            base.order_by(
                Notification.updated_at.desc(), Notification.id.desc()
            )
            .offset((params.page - 1) * params.size)
            .limit(params.size)
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return Page(
            items=list(rows), total=total, page=params.page, size=params.size
        )

    async def recente_nao_lida(
        self,
        *,
        recipient_id: uuid.UUID,
        task_id: uuid.UUID,
        actor_id: uuid.UUID,
        tipos: tuple[str, ...],
        janela: timedelta,
    ) -> Notification | None:
        """O aviso NAO LIDO mais recente deste autor, tarefa e destinatario,
        de um destes tipos, dentro da janela (Spec 053, D18).

        ⚠️ A janela conta a partir de `now()` do BANCO -- que e o instante da
        TRANSACAO (armadilha do AGENTS.md). Numa mesma requisicao todas as
        comparacoes usam o mesmo relogio, que e o que se quer.
        """
        stmt = (
            self._base_select()
            .where(
                Notification.recipient_id == recipient_id,
                Notification.task_id == task_id,
                Notification.actor_id == actor_id,
                Notification.type.in_(tipos),
                Notification.read_at.is_(None),
                Notification.updated_at >= func.now() - janela,
            )
            .order_by(Notification.updated_at.desc(), Notification.id.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def atualizar(self, row: Notification, *, payload: dict) -> None:
        """Junta uma mudanca nova num aviso existente: payload + `updated_at`."""
        await self.session.execute(
            update(Notification)
            .where(Notification.id == row.id)
            .values(payload=payload, updated_at=func.now())
        )

    async def apagar(self, row: Notification) -> None:
        """Remove um aviso que se ANULOU (Spec 053, D18). Nunca um lido: quem
        chama so chega aqui com `recente_nao_lida`."""
        await self.session.execute(
            delete(Notification).where(Notification.id == row.id)
        )

    async def count_unread(self) -> int:
        """Quantidade de nao-lidas do usuario logado (barato; usado no badge)."""
        tenant = require_tenant()
        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.workspace_id == tenant.workspace_id,
                Notification.recipient_id == tenant.user_id,
                Notification.read_at.is_(None),
            )
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def mark_read(self, notification_id: uuid.UUID) -> bool:
        """Marca UMA notificacao do usuario logado como lida.

        Retorna False se a notificacao nao existe OU nao e do usuario
        (-> 404 no service). Idempotente: marcar uma ja-lida retorna True
        sem reescrever `read_at`. Usa func.now() (hora do banco).
        """
        tenant = require_tenant()
        row = await self.get_by_id(notification_id)  # ja escopado ao workspace
        if row is None or row.recipient_id != tenant.user_id:
            return False
        if row.read_at is None:
            await self.session.execute(
                update(Notification)
                .where(Notification.id == notification_id)
                .values(read_at=func.now())
            )
        return True

    async def mark_all_read(self) -> int:
        """Marca todas as nao-lidas do usuario logado como lidas.

        Retorna quantas foram marcadas.
        """
        tenant = require_tenant()
        stmt = (
            update(Notification)
            .where(
                Notification.workspace_id == tenant.workspace_id,
                Notification.recipient_id == tenant.user_id,
                Notification.read_at.is_(None),
            )
            .values(read_at=func.now())
        )
        result = await self.session.execute(stmt)
        return result.rowcount or 0
