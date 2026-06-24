"""Repositorios de colaboracao (assignees / watchers) -- Entrega 4.

Padrao: herdam BaseRepository (filtro automatico de tenant via
`_base_select`). As tabelas tem `workspace_id` mas NAO tem `deleted_at`
-- nao ha soft-delete de assignment/watcher; remover e DELETE fisico.
Toda query parte de `_base_select()`. Repository nao comita.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete

from app.core.tenant import require_tenant
from app.db.models import TaskAssignment, TaskWatcher
from app.db.repository import BaseRepository


class TaskAssignmentRepository(BaseRepository[TaskAssignment]):
    """Acesso a dados de responsaveis de uma task, escopado ao tenant."""

    model = TaskAssignment

    async def list_user_ids(self, task_id: uuid.UUID) -> list[uuid.UUID]:
        """user_ids dos responsaveis da task (ordem estavel por assigned_at)."""
        stmt = (
            self._base_select()
            .with_only_columns(TaskAssignment.user_id)
            .where(TaskAssignment.task_id == task_id)
            .order_by(TaskAssignment.assigned_at.asc())
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return list(rows)

    async def list_user_ids_for_tasks(
        self, task_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[uuid.UUID]]:
        """assignees de VARIAS tasks em UMA query (evita N+1 no quadro).

        Devolve {task_id: [user_id, ...]} com toda task pedida presente
        (lista vazia se nao tem responsavel). Ordem estavel por assigned_at.
        """
        if not task_ids:
            return {}
        stmt = (
            self._base_select()
            .with_only_columns(TaskAssignment.task_id, TaskAssignment.user_id)
            .where(TaskAssignment.task_id.in_(task_ids))
            .order_by(TaskAssignment.assigned_at.asc())
        )
        rows = (await self.session.execute(stmt)).all()
        out: dict[uuid.UUID, list[uuid.UUID]] = {tid: [] for tid in task_ids}
        for task_id, user_id in rows:
            out.setdefault(task_id, []).append(user_id)
        return out

    async def get(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> TaskAssignment | None:
        """Par (task, user) ou None. Usado pra idempotencia."""
        stmt = self._base_select().where(
            TaskAssignment.task_id == task_id,
            TaskAssignment.user_id == user_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    def add(
        self,
        *,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        assigned_by: uuid.UUID,
    ) -> TaskAssignment:
        """Registra um responsavel na sessao (sem commit)."""
        tenant = require_tenant()
        row = TaskAssignment(
            workspace_id=tenant.workspace_id,
            task_id=task_id,
            user_id=user_id,
            assigned_by=assigned_by,
        )
        self.session.add(row)
        return row

    async def remove(self, *, task_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Remove o par (DELETE fisico). True se removeu, False se nao existia."""
        stmt = (
            delete(TaskAssignment)
            .where(
                TaskAssignment.workspace_id == require_tenant().workspace_id,
                TaskAssignment.task_id == task_id,
                TaskAssignment.user_id == user_id,
            )
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0


class TaskWatcherRepository(BaseRepository[TaskWatcher]):
    """Acesso a dados de observadores de uma task, escopado ao tenant."""

    model = TaskWatcher

    async def list_user_ids(self, task_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = (
            self._base_select()
            .with_only_columns(TaskWatcher.user_id)
            .where(TaskWatcher.task_id == task_id)
            .order_by(TaskWatcher.id.asc())
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return list(rows)

    async def get(
        self, *, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> TaskWatcher | None:
        stmt = self._base_select().where(
            TaskWatcher.task_id == task_id,
            TaskWatcher.user_id == user_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    def add(self, *, task_id: uuid.UUID, user_id: uuid.UUID) -> TaskWatcher:
        tenant = require_tenant()
        row = TaskWatcher(
            workspace_id=tenant.workspace_id,
            task_id=task_id,
            user_id=user_id,
        )
        self.session.add(row)
        return row

    async def remove(self, *, task_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = delete(TaskWatcher).where(
            TaskWatcher.workspace_id == require_tenant().workspace_id,
            TaskWatcher.task_id == task_id,
            TaskWatcher.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0
