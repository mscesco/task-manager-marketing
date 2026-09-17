"""Os avisos do que ACONTECE numa tarefa (Spec 053, fatia C).

Coluna, prazo, descricao, arquivar, desarquivar e excluir avisam seguidores +
responsaveis + criador, menos quem fez (D14, D15).

⚠️⚠️ SO O GESTO DIRETO AVISA (D16), e e por isso que este modulo e chamado
pelas ROTAS, e nunca de dentro do `TaskService`. O mesmo `TaskService.update`
roda em LACO quando alguem apaga uma coluna no lote
(`BoardService.apagar_coluna`, uma chamada por tarefa movida) -- emitir la
dentro mandaria 40 avisos por apagar uma coluna com 40 tarefas. Tambem nao
avisam a cascata de conclusao (SQL em massa) nem o job `archive-stale` (outro
metodo). O guardiao e `test_avisos_de_mudanca_053c_db.py`.

A forma e sempre a mesma: a rota tira um RETRATO da tarefa antes do servico,
chama o servico, e entrega retrato + tarefa depois para este modulo comparar.
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
    """O que os avisos comparam, copiado ANTES da mudanca.

    ⚠️ VALORES, e nao a `Task`: o servico altera o MESMO objeto da sessao (o
    identity map devolve a mesma instancia), entao guardar a referencia seria
    comparar a tarefa com ela mesma.
    """

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
    """Compara o antes e o depois de um gesto e emite os avisos da Spec 053."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._notify = NotificationEmitter(session)

    async def retrato(self, task_id: uuid.UUID) -> RetratoDaTarefa | None:
        """Tira o retrato antes do servico. `None` se a tarefa nao existe.

        ⚠️ Nao confere visibilidade -- quem confere e o servico chamado logo em
        seguida. O retrato so e usado se o servico nao recusar.
        """
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
        """PATCH /tasks/{id}: coluna, prazo e descricao (D14)."""
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

        # §6.4: COMPARA VALOR. O front manda start_date, due_date e due_time
        # juntos em todo PATCH de datas -- `fields_set` diria "mudou" sempre.
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
        """DELETE /tasks/{id}. Avisa so pela tarefa excluida, nao pelas filhas
        que foram junto (Spec 053, §9.1: gesto direto).

        ⚠️ O aviso de exclusao MOSTRA o titulo (§9.2): quem recebe via a tarefa
        ate este instante. As linhas de seguidor e responsavel continuam no
        banco depois do soft-delete, entao a audiencia ainda se calcula.
        """
        await self._emitir(
            NotificationType.TASK_DELETED, task, await self._destinatarios(task)
        )

    # ----------------------------------------------------
    async def _destinatarios(self, task: Task) -> list[uuid.UUID]:
        """Seguidores + responsaveis + criador (D15). O emissor tira o autor e
        quem nao alcanca a tarefa."""
        seguidores = await TaskWatcherRepository(self._session).list_user_ids(task.id)
        responsaveis = await TaskAssignmentRepository(self._session).list_user_ids(
            task.id
        )
        return list(dict.fromkeys([*seguidores, *responsaveis, task.created_by]))

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
        destinatarios: list[uuid.UUID],
        *,
        extra: dict | None = None,
    ) -> None:
        if not destinatarios:
            return
        await self._notify.mudanca_na_tarefa(
            tipo=tipo,
            recipient_ids=destinatarios,
            actor_id=require_tenant().user_id,
            task_id=task.id,
            task_title=task.title,
            extra=extra,
        )
