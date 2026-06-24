"""MeService -- recursos do usuario logado ("minhas tarefas").

Entrega 6 / ADR 0017 / ADR 0018. Le as relacoes do usuario corrente com
tasks e marca out_of_scope reusando o guard puro `task_visible` (sem
duplicar regra de time).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Task
from app.modules.auth.domain import team_scope
from app.modules.tasks.application.task_guards import task_visible
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import Page, PageParams


@dataclass(frozen=True)
class MyTaskRow:
    """Item de /me/assignments ja resolvido."""

    task: Task
    relations: frozenset[str]  # subset de {"assignee","creator","watcher"}
    out_of_scope: bool


class MeService:
    """Leitura das relacoes do usuario corrente com tasks."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = TaskRepository(session)

    async def list_assignments(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
    ) -> Page[MyTaskRow]:
        """Lista tasks onde tenho ao menos uma das `relations`.

        out_of_scope = nao enxergo pela lente atual (ADR 0017). Calculado por
        item com `task_visible` (fonte unica da regra de visibilidade). Para
        admin (lente None) nada e out_of_scope. A ordem (updated_at desc) vem
        do repositorio e e preservada; agrupar por escopo e papel do front.
        """
        tenant = require_tenant()
        visible = team_scope.visible_team_ids(tenant.memberships, tenant.team_tree)

        page = await self._repo.list_my_relations(params, relations=relations)

        rows = [
            MyTaskRow(
                task=task,
                relations=rels,
                out_of_scope=not task_visible(
                    task=task,
                    project=project,
                    viewer_user_id=tenant.user_id,
                    visible=visible,
                ),
            )
            for task, project, rels in page.items
        ]
        return Page(items=rows, total=page.total, page=page.page, size=page.size)
