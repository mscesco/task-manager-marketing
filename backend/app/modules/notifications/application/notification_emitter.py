"""Emissor de notificacoes (Spec 018) -- PONTO UNICO DE EMISSAO.

Os services que disparam eventos (designar responsavel, comentar)
instanciam um `NotificationEmitter(session)` e chamam UM metodo por tipo
de evento. Nada de `if` de notificacao espalhado pelos services: cada
tipo novo no futuro = um metodo novo aqui, chamado de um lugar so.

BEST-EFFORT (blindagem): a emissao roda num SAVEPOINT (`begin_nested`) com
flush forcado dentro dele. Se a notificacao falhar por QUALQUER motivo
(tabela ausente, constraint, erro de query), faz rollback SO do savepoint
-- a acao principal (assignment/comentario), ja flushada ANTES, sobrevive
-- e loga loud. A emissao NUNCA propaga excecao: notificacao e efeito
colateral e jamais pode derrubar a acao que a disparou.

Por que savepoint e nao try/except simples: o INSERT da notificacao, se
adiado pro commit da transacao compartilhada, aborta a transacao INTEIRA
no Postgres quando falha -- envenenando tambem a acao principal. O flush
DENTRO do savepoint faz a falha acontecer isolada e reversivel.

Snapshot de exibicao (D1): no momento da emissao gravamos
`{actor_name, task_title}` no payload. O read fica barato (scan de 1
tabela) ao custo de o titulo ficar "congelado" se a task for renomeada.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import User
from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)

logger = get_logger(__name__)


class NotificationEmitter:
    """Emite notificacoes para os eventos do dominio. Best-effort, nao comita."""

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

        async def _do() -> None:
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

        await self._emit_safely("TASK_ASSIGNED", _do)

    async def comment_on_task(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
    ) -> None:
        """Notifica a audiencia da task de que houve um comentario.

        Fan-out: uma notificacao por destinatario, com DEDUP (mesmo id nao
        notifica duas vezes) e EXCLUINDO o autor do comentario. Se nao
        sobrar ninguem, nao emite nada.
        """
        # dict.fromkeys: dedup preservando ordem; depois tira o autor.
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in alvos:
                self._repo.create(
                    recipient_id=rid,
                    actor_id=actor_id,
                    type=NotificationType.TASK_COMMENTED.value,
                    task_id=task_id,
                    comment_id=comment_id,
                    payload={"actor_name": actor_name, "task_title": task_title},
                )

        await self._emit_safely("TASK_COMMENTED", _do)

    async def mentioned(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
    ) -> None:
        """Notifica quem foi @mencionado num comentario (Spec 019).

        Fan-out com DEDUP e EXCLUINDO o autor (auto-mencao nao notifica). Se
        nao sobrar ninguem, nao emite. Mesmo savepoint best-effort: falha aqui
        nunca derruba o comentario.
        """
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in alvos:
                self._repo.create(
                    recipient_id=rid,
                    actor_id=actor_id,
                    type=NotificationType.TASK_MENTIONED.value,
                    task_id=task_id,
                    comment_id=comment_id,
                    payload={"actor_name": actor_name, "task_title": task_title},
                )

        await self._emit_safely("TASK_MENTIONED", _do)

    async def comment_reacted(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
        emoji: str,
    ) -> None:
        """Avisa o autor de que reagiram ao comentario dele (Spec 050, fatia B).

        No-op se o autor reagiu ao proprio comentario (decisao da Camila).

        ⚠️ "SO QUANDO NASCE" NAO E DECIDIDO AQUI, e sim por quem chama: o
        emissor nao sabe se foi reacao nova ou troca de emoji. Quem sabe e o
        banco, no mesmo comando do upsert (`CommentReactionRepository.upsert`).

        ⚠️ E O ALCANCE TAMBEM NAO: filtrar quem enxerga a tarefa e do service,
        mesmo desenho das mencoes (`_emitir_mencoes`). O emissor so escreve.

        `emoji` vai no payload: o texto do sino mostra qual foi, e a notificacao
        e snapshot -- se a pessoa trocar depois, o aviso continua dizendo o que
        aconteceu naquele momento.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.TASK_COMMENT_REACTED.value,
                task_id=task_id,
                comment_id=comment_id,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                    "emoji": emoji,
                },
            )

        await self._emit_safely("TASK_COMMENT_REACTED", _do)

    async def due_soon(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        task_id: uuid.UUID,
        task_title: str,
        due_date_iso: str,
    ) -> None:
        """Spec 023: avisa os destinatarios que a task vence em ~2 dias.

        Notificacao de SISTEMA -- `actor_id=None`, sem _actor_name. Fan-out com
        DEDUP. Sem auto-exclusao (nao ha ator). Se nao houver destinatario,
        nao emite.
        """
        alvos = list(dict.fromkeys(recipient_ids))
        if not alvos:
            return

        async def _do() -> None:
            for rid in alvos:
                self._repo.create(
                    recipient_id=rid,
                    actor_id=None,
                    type=NotificationType.TASK_DUE_SOON.value,
                    task_id=task_id,
                    payload={"task_title": task_title, "due_date": due_date_iso},
                )

        await self._emit_safely("TASK_DUE_SOON", _do)

    async def overdue(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        task_id: uuid.UUID,
        task_title: str,
        due_date_iso: str,
    ) -> None:
        """Spec 023: avisa os destinatarios que a task atrasou.

        Notificacao de SISTEMA -- `actor_id=None`, sem _actor_name. Fan-out com
        DEDUP. Sem auto-exclusao. Se nao houver destinatario, nao emite.
        """
        alvos = list(dict.fromkeys(recipient_ids))
        if not alvos:
            return

        async def _do() -> None:
            for rid in alvos:
                self._repo.create(
                    recipient_id=rid,
                    actor_id=None,
                    type=NotificationType.TASK_OVERDUE.value,
                    task_id=task_id,
                    payload={"task_title": task_title, "due_date": due_date_iso},
                )

        await self._emit_safely("TASK_OVERDUE", _do)

    async def alcance_perdido(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        quantidade: int,
        subtimes: list[str],
    ) -> None:
        """Avisa que ela deixou de ser responsavel por N tarefas (Spec 037 E9).

        ⚠️ UMA notificacao por MOVIMENTACAO, nunca uma por tarefa. Medido em
        06/08: duas pessoas carregam 30 das 33 tarefas que travariam hoje --
        fan-out por tarefa entregaria 18 notificacoes de uma vez a mesma
        pessoa, no mesmo segundo, e isso nao e aviso, e ruido que ensina a
        ignorar o sino.

        ⚠️ SEM `task_id`, e a ausencia e o ponto: a notificacao NAO aponta para
        uma tarefa, porque ela fala de um conjunto. Alem disso, a pessoa acabou
        de perder o alcance -- um link levaria a um 404.

        ⚠️ `subtimes` no PLURAL. Rebaixar um MANAGER da raiz tira oito subtimes
        de uma vez; a mensagem tem de caber nesse caso, nao so no de mover
        alguem de um subtime para outro.

        No-op se `quantidade == 0`: sem perda, sem aviso.
        """
        if quantidade <= 0:
            return

        async def _do() -> None:
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.ACCESS_LOST.value,
                task_id=None,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "quantidade": quantidade,
                    "subtimes": subtimes,
                },
            )

        await self._emit_safely("ACCESS_LOST", _do)

    async def _emit_safely(
        self, tipo: str, do: Callable[[], Awaitable[None]]
    ) -> None:
        """Roda a criacao de notificacao(oes) num SAVEPOINT, best-effort.

        Em caso de falha: rollback SO do savepoint (a acao principal
        sobrevive) + log loud. NUNCA propaga.
        """
        try:
            async with self._session.begin_nested():
                await do()
                await self._session.flush()
        except Exception:
            # logger.exception captura o traceback -> loud no log do deploy.
            logger.exception("notification.emit_failed", tipo=tipo)

    async def _actor_name(self, actor_id: uuid.UUID) -> str:
        """Nome do ator (snapshot), escopado ao tenant. '' se nao achar."""
        stmt = select(User.name).where(
            User.id == actor_id,
            User.workspace_id == require_tenant().workspace_id,
        )
        name = (await self._session.execute(stmt)).scalar_one_or_none()
        return name or ""
