"""Dominio de notificacoes: tipos e DTO de leitura.

No banco `notification.type` e `String(40)`, nao ENUM nativo: tipo novo nao
precisa de migration.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class NotificationType(str, Enum):
    """Tipos de notificacao in-app."""

    TASK_ASSIGNED = "TASK_ASSIGNED"
    TASK_COMMENTED = "TASK_COMMENTED"
    TASK_MENTIONED = "TASK_MENTIONED"
    # Avisos de prazo (job de sistema, sem ator).
    TASK_DUE_SOON = "TASK_DUE_SOON"
    TASK_OVERDUE = "TASK_OVERDUE"
    # Perda de alcance por mudanca de vinculo; ver `NotificationEmitter.alcance_perdido`.
    ACCESS_LOST = "ACCESS_LOST"
    # Reacao nova ao comentario da pessoa; trocar o emoji nao notifica.
    TASK_COMMENT_REACTED = "TASK_COMMENT_REACTED"
    # Resposta ao comentario da pessoa, mesmo que ela nao siga a tarefa.
    TASK_COMMENT_REPLIED = "TASK_COMMENT_REPLIED"
    # Outra pessoa colocou ou tirou alguem como seguidor.
    TASK_WATCH_ADDED = "TASK_WATCH_ADDED"
    TASK_WATCH_REMOVED = "TASK_WATCH_REMOVED"
    # Mudancas na tarefa, para seguidores, responsaveis e criador; so o gesto
    # direto avisa (ver `tasks/application/task_notices.py`).
    TASK_COLUMN_CHANGED = "TASK_COLUMN_CHANGED"
    TASK_DUE_CHANGED = "TASK_DUE_CHANGED"
    TASK_DESCRIPTION_CHANGED = "TASK_DESCRIPTION_CHANGED"
    TASK_ARCHIVED = "TASK_ARCHIVED"
    TASK_UNARCHIVED = "TASK_UNARCHIVED"
    TASK_DELETED = "TASK_DELETED"


@dataclass(frozen=True, slots=True)
class AlvoDeFiltro:
    """Uma sugestao do campo "Tarefa ou projeto"."""

    kind: str  # "task" | "project"
    id: uuid.UUID
    title: str


@dataclass(frozen=True, slots=True)
class NotificationDTO:
    """Notificacao para leitura (API). Imutavel."""

    id: uuid.UUID
    type: str
    actor_id: uuid.UUID | None
    task_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    payload: dict | None
    read_at: datetime | None
    created_at: datetime
    updated_at: datetime
    #: "ok" = a tarefa existe e quem le ainda a alcanca;
    #: "gone" = excluida ou fora do alcance; None = aviso sem tarefa.
    task_access: str | None = None
