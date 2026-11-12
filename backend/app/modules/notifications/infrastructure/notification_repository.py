"""Repository de notificacoes.

Alem do tenant, leituras e marcacoes filtram por `recipient_id == usuario
logado`. Sem soft-delete. Nunca comita.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import delete, func, insert, select, text, update

from app.core.tenant import require_tenant
from app.db.models import Notification, Task
from app.db.repository import BaseRepository
from app.modules.notifications.domain.preferences import (
    PAPEL_UNICO,
    TIPOS_DE_PAPEL_UNICO,
    TIPOS_POR_PAPEL,
)
from app.shared.pagination import Page, PageParams


def _em(tipos: tuple[str, ...]) -> str:
    """Os tipos como lista SQL literal: sao constantes do catalogo, nunca entrada de usuario."""
    return ", ".join(f"'{t}'" for t in tipos) or "''"


#: A regra de silencio, usada por todas as leituras e pela contagem do sino.
#: Silenciado quando:
#:   - tipo com papel: `roles` nao vazio e ha mute para cada papel do aviso;
#:   - tipo de papel unico: ha mute com `role = 'none'`.
#: Tipo travado nao esta em nenhuma das listas, entao nunca silencia.
_SILENCIADA = f"""(
    notification.type IN ({_em(TIPOS_POR_PAPEL)})
    AND cardinality(notification.roles) > 0
    AND NOT EXISTS (
        SELECT 1 FROM unnest(notification.roles) AS papel
        WHERE NOT EXISTS (
            SELECT 1 FROM notification_mute m
            WHERE m.workspace_id = CAST(:silencio_ws AS uuid)
              AND m.user_id = CAST(:silencio_me AS uuid)
              AND m.type = notification.type
              AND m.role = papel
        )
    )
) OR (
    notification.type IN ({_em(TIPOS_DE_PAPEL_UNICO)})
    AND EXISTS (
        SELECT 1 FROM notification_mute m
        WHERE m.workspace_id = CAST(:silencio_ws AS uuid)
          AND m.user_id = CAST(:silencio_me AS uuid)
          AND m.type = notification.type
          AND m.role = '{PAPEL_UNICO}'
    )
)"""


def filtro_de_silencio(*, silenciadas: bool):
    """O recorte de silencio do usuario logado.

    `silenciadas=True` devolve so as silenciadas (a aba "Silenciadas");
    `False` devolve o resto (sino, "Nao lidas", "Todas", contagem).
    """
    tenant = require_tenant()
    sql = _SILENCIADA if silenciadas else f"NOT ({_SILENCIADA})"
    return text(sql).bindparams(
        silencio_ws=str(tenant.workspace_id), silencio_me=str(tenant.user_id)
    )


def filtrar(
    stmt,
    *,
    tipos: tuple[str, ...] = (),
    task_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
):
    """Os filtros da tela de notificacoes, compartilhados pela listagem e pelo
    "marcar como lidas" para os dois recortarem o mesmo conjunto.

    `project_id`: a notificacao nao guarda projeto, entao passa pela tarefa.
    Tarefa apagada continua na tabela (soft-delete) e continua casando.
    """
    if tipos:
        stmt = stmt.where(Notification.type.in_(tipos))
    if task_id is not None:
        stmt = stmt.where(Notification.task_id == task_id)
    if project_id is not None:
        stmt = stmt.where(
            Notification.task_id.in_(
                select(Task.id).where(
                    Task.project_id == project_id,
                    Task.workspace_id == require_tenant().workspace_id,
                )
            )
        )
    return stmt


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
        roles: tuple[str, ...] = (),
    ) -> Notification:
        """Registra uma notificacao na sessao (sem commit).

        `roles`: por que o aviso chegou (`watcher`, `assignee`, `creator`);
        vazio nos tipos pessoais.
        """
        tenant = require_tenant()
        row = Notification(
            workspace_id=tenant.workspace_id,
            recipient_id=recipient_id,
            actor_id=actor_id,
            type=type,
            task_id=task_id,
            comment_id=comment_id,
            payload=payload,
            roles=list(roles),
        )
        self.session.add(row)
        return row

    async def create_many(
        self,
        *,
        type: str,
        rows: list[tuple[uuid.UUID, uuid.UUID, dict, tuple[str, ...]]],
    ) -> None:
        """Varias notificacoes de sistema (sem ator) num INSERT so.

        `rows` = `(recipient_id, task_id, payload, roles)`.
        """
        if not rows:
            return
        ws = require_tenant().workspace_id
        await self.session.execute(
            insert(Notification).values(
                [
                    {
                        "workspace_id": ws,
                        "recipient_id": recipient_id,
                        "actor_id": None,
                        "type": type,
                        "task_id": task_id,
                        "payload": payload,
                        "roles": list(roles),
                    }
                    for recipient_id, task_id, payload, roles in rows
                ]
            )
        )

    async def list_for_me(
        self,
        *,
        params: PageParams,
        unread_only: bool = False,
        tipos: tuple[str, ...] = (),
        task_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        muted: bool = False,
    ) -> Page[Notification]:
        """Feed do usuario logado, mais novas primeiro.

        Desempate por `id` porque func.now() e constante na transacao.
        `muted=False` esconde as silenciadas; `True` mostra so elas.
        """
        me = require_tenant().user_id
        base = self._base_select().where(Notification.recipient_id == me)
        if unread_only:
            base = base.where(Notification.read_at.is_(None))
        base = filtrar(base, tipos=tipos, task_id=task_id, project_id=project_id)
        base = base.where(filtro_de_silencio(silenciadas=muted))

        total = (
            await self.session.execute(
                select(func.count()).select_from(base.subquery())
            )
        ).scalar_one()

        stmt = (
            # `updated_at`: o aviso que juntou uma mudanca nova sobe para o topo.
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
        """O aviso nao lido mais recente deste autor, tarefa e destinatario,
        de um destes tipos, dentro da janela.

        A janela conta do `now()` do banco, que e o instante da transacao.
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

    async def atualizar(
        self, row: Notification, *, payload: dict, roles: tuple[str, ...] = ()
    ) -> None:
        """Junta uma mudanca nova num aviso existente: payload + `updated_at`.

        Os papeis se unem, para o aviso juntado nao ser silenciado por um
        toggle que cobre so parte do que ele conta.
        """
        unidos = list(dict.fromkeys([*(row.roles or []), *roles]))
        await self.session.execute(
            update(Notification)
            .where(Notification.id == row.id)
            .values(payload=payload, roles=unidos, updated_at=func.now())
        )

    async def apagar(self, row: Notification) -> None:
        """Remove um aviso que se anulou (sempre vindo de `recente_nao_lida`)."""
        await self.session.execute(
            delete(Notification).where(Notification.id == row.id)
        )

    async def task_ids_para_mim(self) -> list[uuid.UUID]:
        """As tarefas que aparecem em alguma notificacao do usuario logado."""
        tenant = require_tenant()
        rows = await self.session.execute(
            select(Notification.task_id)
            .where(
                Notification.workspace_id == tenant.workspace_id,
                Notification.recipient_id == tenant.user_id,
                Notification.task_id.is_not(None),
            )
            .distinct()
        )
        return [r[0] for r in rows.all()]

    async def count_unread(self, *, muted: bool = False) -> int:
        """Nao-lidas do usuario logado para o badge; `muted=True` conta so as silenciadas."""
        tenant = require_tenant()
        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.workspace_id == tenant.workspace_id,
                Notification.recipient_id == tenant.user_id,
                Notification.read_at.is_(None),
                filtro_de_silencio(silenciadas=muted),
            )
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def mark_read(self, notification_id: uuid.UUID) -> bool:
        """Marca uma notificacao do usuario logado como lida.

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

    async def mark_all_read(
        self,
        *,
        tipos: tuple[str, ...] = (),
        task_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        muted: bool = False,
    ) -> int:
        """Marca as nao-lidas do usuario logado como lidas -- todas, ou so as
        do filtro, no mesmo recorte de silencio da aba. Retorna quantas.
        """
        tenant = require_tenant()
        stmt = filtrar(
            update(Notification).where(
                Notification.workspace_id == tenant.workspace_id,
                Notification.recipient_id == tenant.user_id,
                Notification.read_at.is_(None),
                filtro_de_silencio(silenciadas=muted),
            ),
            tipos=tipos,
            task_id=task_id,
            project_id=project_id,
        ).values(read_at=func.now())
        result = await self.session.execute(stmt)
        return result.rowcount or 0
