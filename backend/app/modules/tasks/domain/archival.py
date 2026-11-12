"""Elegibilidade de auto-arquivamento -- predicado puro (sem DB).

Elegivel: status terminal (COMPLETED/CANCELLED) e `terminal_since < now - dias`.
Espelha `TaskRepository.list_stale_terminal`: mudou aqui, muda la.

O `status` continua checado de proposito: `terminal_since` numa tarefa viva
falha fechado (nao arquiva).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final

from app.db.models.enums import TaskStatus

#: Os status que contam como "coluna terminal" (param o relogio do arquivamento).
TERMINAL_STATUSES: Final[frozenset[TaskStatus]] = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
)


def is_terminal(status: TaskStatus) -> bool:
    """True se o status para o relogio do arquivamento (`terminal_since`)."""
    return status in TERMINAL_STATUSES


def is_stale_terminal(
    *,
    status: TaskStatus,
    terminal_since: datetime | None,
    now: datetime,
    days: int,
) -> bool:
    """True se a task terminal esta parada ha mais dias que o limite.

    `now` injetado (testavel com relogio fake). `terminal_since` None ->
    NAO elegivel (falha fechado: nao arquiva o que nao da pra datar). Isso
    cobre tanto a tarefa nunca datada quanto a que saiu de terminal e teve o
    relogio limpo.
    """
    if status not in TERMINAL_STATUSES:
        return False
    cutoff = now - timedelta(days=days)
    return terminal_since is not None and terminal_since < cutoff
