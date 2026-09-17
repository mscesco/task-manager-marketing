"""Schemas de API de notificacoes (Spec 018, F4)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    """Uma notificacao do usuario logado."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    type: str
    actor_id: uuid.UUID | None
    task_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    payload: dict | None
    read_at: datetime | None
    created_at: datetime
    # Spec 053 (C): a ultima mudanca -- difere de `created_at` quando avisos
    # seguidos se juntaram. E o horario que a tela mostra.
    updated_at: datetime
    # Spec 053 (E, D27): "ok" | "gone" (excluida ou sem acesso) | null (sem
    # tarefa). Com "gone" o servidor ja tirou `task_title` do payload -- menos
    # no proprio aviso de exclusao, que o mostra (§9.2).
    task_access: str | None = None


class NotificationListResponse(BaseModel):
    """Feed paginado."""

    items: list[NotificationResponse]
    total: int
    page: int
    size: int


class AlvoResponse(BaseModel):
    """Uma sugestao do filtro "Tarefa ou projeto" (Spec 053, D23)."""

    model_config = {"from_attributes": True}

    kind: str
    id: uuid.UUID
    title: str


class AlvosResponse(BaseModel):
    items: list[AlvoResponse]


class UnreadCountResponse(BaseModel):
    """Contagem de nao-lidas (badge do sino)."""

    count: int


class MarkAllReadResponse(BaseModel):
    """Resultado de marcar todas como lidas."""

    updated: int
