"""Avisos de mudanca numa tarefa (coluna, prazo, descricao, arquivar, excluir).

Avisam seguidores + responsaveis + criador, menos quem fez. So o gesto direto
avisa: por isso e chamado pelas rotas, nunca de dentro do `TaskService` (que
roda em laco ao apagar coluna). A rota tira um retrato antes do servico e
entrega retrato + tarefa depois para comparar.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import BoardColumn, Task
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.notifications.domain.notification import NotificationType
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
    TaskWatcherRepository,
)


@dataclass(frozen=True, slots=True)
class RetratoDaTarefa:
    """Valores copiados antes da mudanca (nao a `Task`: o servico altera o mesmo objeto)."""

    column_id: uuid.UUID | None
    due_date: date | None
    due_time: time | None
    description: str | None
    is_archived: bool


def _prazo(d: date | None, t: time | None) -> dict | None:
    """O prazo como vai no payload: `{"date": "2026-09-20", "time": "18:00"}`."""
    if d is None:
        return None
    return {"date": d.isoformat(), "time": t.strftime("%H:%M") if t else None}


class AvisosDaTarefa:
    """Compara o antes e o depois de um gesto e emite os avisos."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._notify = NotificationEmitter(session)

    async def retrato(self, task_id: uuid.UUID) -> RetratoDaTarefa | None:
        """Retrato antes do servico (`None` se nao existe). Visibilidade e o servico que confere."""
        task = await self._session.get(Task, task_id)
        if task is None:
            return None
        return RetratoDaTarefa(
            column_id=task.column_id,
            due_date=task.due_date,
            due_time=task.due_time,
            description=task.description,
            is_archived=task.is_archived,
        )

    async def depois_da_edicao(
        self, antes: RetratoDaTarefa | None, task: Task
    ) -> None:
        """PATCH /tasks/{id}: coluna, prazo e descricao."""
        if antes is None:
            return
        destinatarios = await self._destinatarios(task)
        if not destinatarios:
            return

        if antes.column_id != task.column_id:
            nomes = await self._nomes_das_colunas([antes.column_id, task.column_id])
            await self._emitir(
                NotificationType.TASK_COLUMN_CHANGED, task, destinatarios,
                extra={
                    "from_column": nomes.get(antes.column_id),
                    "to_column": nomes.get(task.column_id),
                },
            )

        # Compara valor: o front manda as tres datas juntas, `fields_set` diria "mudou" sempre.
        if (antes.due_date, antes.due_time) != (task.due_date, task.due_time):
            await self._emitir(
                NotificationType.TASK_DUE_CHANGED, task, destinatarios,
                extra={
                    "from_due": _prazo(antes.due_date, antes.due_time),
                    "to_due": _prazo(task.due_date, task.due_time),
                },
            )

        if (antes.description or "") != (task.description or ""):
            await self._emitir(
                NotificationType.TASK_DESCRIPTION_CHANGED, task, destinatarios
            )

    async def depois_de_arquivar(
        self, antes: RetratoDaTarefa | None, task: Task
    ) -> None:
        """POST /archive e /unarchive. Idempotente no servico -> so avisa se o
        estado MUDOU de fato."""
        if antes is None or antes.is_archived == task.is_archived:
            return
        tipo = (
            NotificationType.TASK_ARCHIVED
            if task.is_archived
            else NotificationType.TASK_UNARCHIVED
        )
        await self._emitir(tipo, task, await self._destinatarios(task))

    async def depois_de_excluir(self, task: Task) -> None:
        """DELETE /tasks/{id}. Avisa so pela tarefa excluida, nao pelas filhas.

        Seguidores e responsaveis seguem no banco apos o soft-delete: a audiencia ainda se calcula.
        """
        await self._emitir(
            NotificationType.TASK_DELETED, task, await self._destinatarios(task)
        )

    # ----------------------------------------------------
    async def _destinatarios(self, task: Task) -> dict[uuid.UUID, list[str]]:
        """Seguidores + responsaveis + criador, cada um com os papeis que tem na tarefa.

        O emissor tira o autor do gesto e quem nao alcanca a tarefa.
        """
        papeis: dict[uuid.UUID, list[str]] = {}
        for uid in await TaskWatcherRepository(self._session).list_user_ids(task.id):
            papeis.setdefault(uid, []).append("watcher")
        for uid in await TaskAssignmentRepository(self._session).list_user_ids(
            task.id
        ):
            papeis.setdefault(uid, []).append("assignee")
        papeis.setdefault(task.created_by, []).append("creator")
        return papeis

    async def _nomes_das_colunas(
        self, ids: list[uuid.UUID | None]
    ) -> dict[uuid.UUID, str]:
        validos = [i for i in ids if i is not None]
        if not validos:
            return {}
        rows = await self._session.execute(
            select(BoardColumn.id, BoardColumn.name).where(BoardColumn.id.in_(validos))
        )
        return {cid: nome for cid, nome in rows.all()}

    async def _emitir(
        self,
        tipo: NotificationType,
        task: Task,
        destinatarios: dict[uuid.UUID, list[str]],
        *,
        extra: dict | None = None,
    ) -> None:
        if not destinatarios:
            return
        await self._notify.mudanca_na_tarefa(
            tipo=tipo,
            recipient_ids=list(destinatarios),
            papeis=destinatarios,
            actor_id=require_tenant().user_id,
            task_id=task.id,
            task_title=task.title,
            extra=extra,
        )
