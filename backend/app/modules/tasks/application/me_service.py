"""MeService -- recursos do usuario logado ("minhas tarefas").

Fino de proposito: a lente de time e aplicada no repositorio.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Task
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import Page, PageParams


@dataclass(frozen=True)
class MyTaskRow:
    """Item de /me/assignments ja resolvido."""

    task: Task
    relations: frozenset[str]  # subset de {"assignee","creator","watcher"}


class MeService:
    """Leitura das relacoes do usuario corrente com tasks."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = TaskRepository(session)

    async def list_assignments(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
        under_team_id: uuid.UUID | None,
    ) -> Page[MyTaskRow]:
        """Lista tasks onde tenho ao menos uma das `relations`.

        A lente de time e a ordem (updated_at desc) vem de `list_my_relations`.
        """
        page = await self._repo.list_my_relations(
            params, relations=relations, under_team_id=under_team_id
        )

        rows = [
            MyTaskRow(task=task, relations=rels)
            for task, _project, rels in page.items
        ]
        return Page(items=rows, total=page.total, page=page.page, size=page.size)
