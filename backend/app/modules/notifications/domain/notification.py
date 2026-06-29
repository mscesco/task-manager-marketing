"""Dominio de notificacoes (Spec 018).

NotificationType : tipos suportados. No banco `type` e String; este enum e
    a fonte de verdade dos valores validos no codigo (e o que a emissao usa).
NotificationDTO  : forma de leitura exposta pela API (F4).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class NotificationType(str, Enum):
    """Tipos de notificacao in-app suportados nesta entrega."""

    TASK_ASSIGNED = "TASK_ASSIGNED"
    TASK_COMMENTED = "TASK_COMMENTED"
    TASK_MENTIONED = "TASK_MENTIONED"


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

    @property
    def is_read(self) -> bool:
        return self.read_at is not None
