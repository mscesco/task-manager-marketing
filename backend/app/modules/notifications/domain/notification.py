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
    # Spec 023: avisos de prazo (gerados por job de sistema, sem ator).
    TASK_DUE_SOON = "TASK_DUE_SOON"
    TASK_OVERDUE = "TASK_OVERDUE"
    # Spec 037 (E9): a pessoa perdeu alcance por mudanca de vinculo e deixou
    # de ser responsavel/observadora. UMA por movimentacao, nunca uma por
    # tarefa -- ver `NotificationEmitter.alcance_perdido`.
    #
    # ⚠️ SEM MIGRATION: `notification.type` e `String(40)` no banco, nao ENUM
    # nativo. Este enum e a fonte de verdade do CODIGO, e so dele.
    ACCESS_LOST = "ACCESS_LOST"
    # Spec 050 (fatia B): alguem reagiu ao comentario da pessoa. So quando a
    # reacao NASCE -- trocar o emoji nao notifica (decisao da Camila, 15/09).
    TASK_COMMENT_REACTED = "TASK_COMMENT_REACTED"
    # Spec 053, fatia B (D17): OUTRA pessoa colocou ou tirou alguem como
    # seguidor. Quem se inscreve sozinho nao se avisa.
    TASK_WATCH_ADDED = "TASK_WATCH_ADDED"
    TASK_WATCH_REMOVED = "TASK_WATCH_REMOVED"


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
