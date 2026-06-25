"""Elegibilidade de auto-arquivamento -- predicado PURO (sem DB).

Espelha a regra usada na query do repositorio (TaskRepository.
list_stale_terminal). Mantido puro para teste isolado e para documentar a
regra num lugar so. Se a regra mudar, muda aqui E na query (mesma dupla
pure-domain + SQL ja usada em team_scope).

REGRA (Spec 013, DECISAO A/B):
    Terminal e velha o bastante:
      - COMPLETED: completed_at < now - dias
      - CANCELLED: updated_at  < now - dias   (sem cancelled_at no schema)
    Qualquer outro status: nunca elegivel.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.db.models.enums import TaskStatus


def is_stale_terminal(
    *,
    status: TaskStatus,
    completed_at: datetime | None,
    updated_at: datetime,
    now: datetime,
    days: int,
) -> bool:
    """True se a task em estado terminal passou do limite de dias.

    `now` injetado (testavel com relogio fake). `completed_at` pode ser None
    para uma COMPLETED inconsistente -> nao elegivel (falha fechado: nao
    arquiva o que nao da pra datar).
    """
    cutoff = now - timedelta(days=days)
    if status == TaskStatus.COMPLETED:
        return completed_at is not None and completed_at < cutoff
    if status == TaskStatus.CANCELLED:
        return updated_at < cutoff
    return False
