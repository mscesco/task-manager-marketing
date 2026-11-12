"""Leitura do historico de uma tarefa (quem escreve e `TaskRepository.write_history`).

Quem ve a tarefa ve o historico. O evento sai cru; quem vira frase e o front
(`lib/historicoDaTarefa.ts`).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import Page, PageParams


@dataclass(frozen=True, slots=True)
class HistoryEventDTO:
    """Um evento do historico, como a API o expoe."""

    id: uuid.UUID
    event_type: str
    field_name: str | None
    old_value: dict | None
    new_value: dict | None
    event_metadata: dict | None
    user_id: uuid.UUID
    created_at: datetime


class TaskHistoryService:
    """O historico de uma tarefa, paginado. Sem escrita."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tasks = TaskRepository(session)
        self._guards = TaskScopeGuards(session)

    async def list_for_task(
        self, *, task_id: uuid.UUID, params: PageParams
    ) -> Page[HistoryEventDTO]:
        """Os eventos da tarefa, mais novo primeiro. 404 se nao ve a tarefa."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        # 404 antes de qualquer leitura: senao vaza o historico de tarefa de outro time.
        await self._guards.assert_visible(task)

        linhas, total = await self._tasks.list_history(
            task_id=task_id, limit=params.limit, offset=params.offset
        )
        return Page(
            items=[
                HistoryEventDTO(
                    id=linha.id,
                    event_type=linha.event_type,
                    field_name=linha.field_name,
                    old_value=linha.old_value,
                    new_value=linha.new_value,
                    event_metadata=linha.event_metadata,
                    user_id=linha.user_id,
                    created_at=linha.created_at,
                )
                for linha in linhas
            ],
            total=total,
            page=params.page,
            size=params.size,
        )
