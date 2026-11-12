"""Quais status sao terminais (param o relogio do auto-arquivamento).

A elegibilidade em si fica no SQL de `TaskRepository.list_stale_terminal`.
"""

from __future__ import annotations

from typing import Final

from app.db.models.enums import TaskStatus

#: Os status que contam como "coluna terminal" (param o relogio do arquivamento).
TERMINAL_STATUSES: Final[frozenset[TaskStatus]] = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
)


def is_terminal(status: TaskStatus) -> bool:
    """True se o status para o relogio do arquivamento (`terminal_since`)."""
    return status in TERMINAL_STATUSES

