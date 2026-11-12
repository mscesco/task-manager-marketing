"""Emissor de notificacoes: ponto unico de emissao, um metodo por tipo de evento.

Best-effort: cada emissao roda num savepoint com flush dentro dele. Sem o
savepoint, um INSERT que falhasse no commit abortaria a transacao inteira,
levando junto a acao principal; aqui a falha so loga e nunca propaga.

Todo aviso de tarefa passa pela trava de alcance (`_so_quem_alcanca`) e grava
o papel do destinatario (`watcher`, `assignee`, `creator`), usado pelas
preferencias; tipos pessoais gravam papel vazio, que nunca e silenciado.
O payload guarda `{actor_name, task_title}` como snapshot do momento.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Task, User
from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)

logger = get_logger(__name__)

#: Avisos seguidos do mesmo autor se juntam dentro desta janela.
JANELA_DE_JUNCAO = timedelta(minutes=10)

_T = NotificationType


@dataclass(frozen=True)
class AvisoDePrazo:
    """Uma tarefa do aviso diario de prazo, quem avisar e por qual papel."""

    task: Task
    recipient_ids: list[uuid.UUID]
    papel: str


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
        """Notifica o designado de que virou responsavel pela task (exceto a si mesmo)."""
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
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

        await self._emit_safely("TASK_ASSIGNED", _do)

    async def comment_on_task(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
        papeis: dict[uuid.UUID, list[str]] | None = None,
    ) -> None:
        """Notifica a audiencia da task de um comentario: sem repetidos e sem o autor."""
        # dict.fromkeys: dedup preservando ordem.
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
                self._repo.create(
                    recipient_id=rid,
                    actor_id=actor_id,
                    type=NotificationType.TASK_COMMENTED.value,
                    task_id=task_id,
                    comment_id=comment_id,
                    payload={"actor_name": actor_name, "task_title": task_title},
                    roles=self._papel_de(papeis, rid),
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
        """Notifica quem foi @mencionado num comentario: sem repetidos e sem o autor."""
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
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
        """Avisa o autor de que reagiram ao comentario dele (exceto a si mesmo).

        So quem chama sabe se a reacao e nova ou troca de emoji (pelo upsert de
        `CommentReactionRepository`); troca nao deve chegar aqui.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
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

    async def comment_replied(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
    ) -> None:
        """Avisa o autor de que responderam ao comentario dele (exceto a si mesmo)."""
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.TASK_COMMENT_REPLIED.value,
                task_id=task_id,
                comment_id=comment_id,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
            )

        await self._emit_safely("TASK_COMMENT_REPLIED", _do)

    async def watch_added(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Outra pessoa colocou `recipient_id` para seguir a tarefa (no-op se foi ela)."""
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            await self._juntar(
                recipient_id=recipient_id,
                actor_id=actor_id,
                task_id=task_id,
                tipo=_T.TASK_WATCH_ADDED,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
                opostos=(_T.TASK_WATCH_REMOVED,),
            )

        await self._emit_safely("TASK_WATCH_ADDED", _do)

    async def watch_removed(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Outra pessoa tirou `recipient_id` dos seguidores (no-op se foi ela).

        A saida automatica por perda de alcance nao passa por aqui.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            await self._juntar(
                recipient_id=recipient_id,
                actor_id=actor_id,
                task_id=task_id,
                tipo=_T.TASK_WATCH_REMOVED,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
                opostos=(_T.TASK_WATCH_ADDED,),
            )

        await self._emit_safely("TASK_WATCH_REMOVED", _do)

    async def mudanca_na_tarefa(
        self,
        *,
        tipo: NotificationType,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        extra: dict | None = None,
        papeis: dict[uuid.UUID, list[str]] | None = None,
    ) -> None:
        """Avisos de mudanca: coluna, prazo, descricao, arquivar, desarquivar, excluir.

        Chamado das rotas, nunca do `TaskService`: so a rota sabe se foi gesto
        direto (arraste) ou efeito colateral (apagar coluna).
        """
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return
        opostos: tuple[NotificationType, ...] = ()
        absorve: tuple[NotificationType, ...] = ()
        if tipo is _T.TASK_ARCHIVED:
            opostos = (_T.TASK_UNARCHIVED,)
        elif tipo is _T.TASK_UNARCHIVED:
            opostos = (_T.TASK_ARCHIVED,)
            # "Reativar" e PATCH de coluna + desarquivar: um gesto, um aviso.
            absorve = (_T.TASK_COLUMN_CHANGED,)

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
                await self._juntar(
                    recipient_id=rid,
                    actor_id=actor_id,
                    task_id=task_id,
                    tipo=tipo,
                    payload={
                        "actor_name": actor_name,
                        "task_title": task_title,
                        **(extra or {}),
                    },
                    opostos=opostos,
                    absorve=absorve,
                    roles=self._papel_de(papeis, rid),
                )

        await self._emit_safely(tipo.value, _do)

    async def prazos(self, *, overdue: bool, avisos: list[AvisoDePrazo]) -> None:
        """Avisos de prazo do dia (vence em breve ou atrasou) para um lote de tarefas.

        Notificacao de sistema (`actor_id=None`). Trava, INSERT e savepoint sao
        um so para o lote: uma falha perde os avisos do lote inteiro.
        """
        from app.modules.tasks.application.task_guards import (
            user_ids_that_can_view_tasks,
        )

        lote = [
            (a.task, list(dict.fromkeys(a.recipient_ids)))
            for a in avisos
            if a.recipient_ids
        ]
        if not lote:
            return
        tipo = _T.TASK_OVERDUE if overdue else _T.TASK_DUE_SOON
        papel = {a.task.id: a.papel for a in avisos}

        async def _do() -> None:
            alcance = await user_ids_that_can_view_tasks(self._session, alvos=lote)
            await self._repo.create_many(
                type=tipo.value,
                rows=[
                    (
                        rid,
                        task.id,
                        {
                            "task_title": task.title,
                            "due_date": task.due_date.isoformat(),  # type: ignore[union-attr]
                        },
                        (papel[task.id],),
                    )
                    for task, ids in lote
                    for rid in ids
                    if rid in alcance.get(task.id, set())
                ],
            )

        await self._emit_safely(tipo.value, _do)

    async def alcance_perdido(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        quantidade: int,
        subtimes: list[str],
    ) -> None:
        """Avisa que a pessoa perdeu acesso a N tarefas: um aviso por movimentacao.

        Sem `task_id` de proposito: fala de um conjunto, e um link daria 404.
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

    async def _juntar(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        tipo: NotificationType,
        payload: dict,
        opostos: tuple[NotificationType, ...] = (),
        absorve: tuple[NotificationType, ...] = (),
        roles: tuple[str, ...] = (),
    ) -> None:
        """Juncao de avisos para um destinatario. Na ordem:
          1. `absorve`: aviso recente destes tipos some (o desarquivar leva a
             mudanca de coluna do "Reativar");
          2. `opostos`: se ha um aviso recente do tipo OPOSTO, os dois se anulam
             -- apaga o antigo e nao cria nada (arquivar <-> desarquivar,
             colocar <-> tirar como seguidor);
          3. mesmo tipo recente: combina (`_combinar`); se o estado final e o
             inicial, apaga;
          4. senao, cria.

        "Recente" = nao lido, mesmo autor, mesma tarefa, dentro de
        `JANELA_DE_JUNCAO`. Aviso ja lido nunca e tocado.
        """
        for t in absorve:
            velho = await self._repo.recente_nao_lida(
                recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
                tipos=(t.value,), janela=JANELA_DE_JUNCAO,
            )
            if velho is not None:
                await self._repo.apagar(velho)
        if opostos:
            oposto = await self._repo.recente_nao_lida(
                recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
                tipos=tuple(t.value for t in opostos), janela=JANELA_DE_JUNCAO,
            )
            if oposto is not None:
                await self._repo.apagar(oposto)
                return
        mesmo = await self._repo.recente_nao_lida(
            recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
            tipos=(tipo.value,), janela=JANELA_DE_JUNCAO,
        )
        if mesmo is None:
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=tipo.value,
                task_id=task_id,
                payload=payload,
                roles=roles,
            )
            return
        combinado = _combinar(tipo, mesmo.payload or {}, payload)
        if combinado is None:
            await self._repo.apagar(mesmo)
        else:
            await self._repo.atualizar(mesmo, payload=combinado, roles=roles)

    @staticmethod
    def _papel_de(
        papeis: dict[uuid.UUID, list[str]] | None, rid: uuid.UUID
    ) -> tuple[str, ...]:
        """Os papeis de um destinatario; vazio se nao informado (nunca silenciado)."""
        return tuple((papeis or {}).get(rid, ()))

    async def _so_quem_alcanca(
        self, task_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """A trava: dos `ids`, so quem enxerga a tarefa agora, na mesma ordem.

        Import tardio: os services de `tasks` importam este emissor (ciclo).
        """
        from app.db.models import Task
        from app.modules.tasks.application.task_guards import (
            user_ids_that_can_view_task,
        )

        task = await self._session.get(Task, task_id)
        if task is None:
            return []
        alcancam = await user_ids_that_can_view_task(
            self._session, task=task, user_ids=ids
        )
        return [i for i in ids if i in alcancam]

    async def _emit_safely(
        self, tipo: str, do: Callable[[], Awaitable[None]]
    ) -> None:
        """Roda a criacao num savepoint; na falha, desfaz so ele e loga, sem propagar."""
        try:
            async with self._session.begin_nested():
                await do()
                await self._session.flush()
        except Exception:
            logger.exception("notification.emit_failed", tipo=tipo)

    async def _actor_name(self, actor_id: uuid.UUID) -> str:
        """Nome do ator (snapshot), escopado ao tenant. '' se nao achar."""
        stmt = select(User.name).where(
            User.id == actor_id,
            User.workspace_id == require_tenant().workspace_id,
        )
        name = (await self._session.execute(stmt)).scalar_one_or_none()
        return name or ""


def _combinar(tipo: NotificationType, velho: dict, novo: dict) -> dict | None:
    """O payload de dois avisos do mesmo tipo juntados. `None` = se anularam.

    - coluna: guarda a coluna de ORIGEM do primeiro e a de destino do ultimo;
      origem == destino (foi e voltou) -> some;
    - prazo: guarda o prazo ANTERIOR do primeiro e o novo do ultimo; iguais ->
      some;
    - o resto (descricao, colocar/tirar...): o mais novo vale.
    """
    if tipo is _T.TASK_COLUMN_CHANGED:
        juntado = {**novo, "from_column": velho.get("from_column")}
        return None if juntado["from_column"] == juntado.get("to_column") else juntado
    if tipo is _T.TASK_DUE_CHANGED:
        juntado = {**novo, "from_due": velho.get("from_due")}
        return None if juntado["from_due"] == juntado.get("to_due") else juntado
    return novo
