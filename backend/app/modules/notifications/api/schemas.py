"""Schemas de API de notificacoes."""

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
    # Difere de `created_at` quando avisos seguidos se juntaram; e o horario da tela.
    updated_at: datetime
    # "ok" | "gone" (excluida ou sem acesso) | null (sem tarefa). Com "gone" o
    # servidor tira `task_title` do payload, menos no proprio aviso de exclusao.
    task_access: str | None = None


class NotificationListResponse(BaseModel):
    """Feed paginado."""

    items: list[NotificationResponse]
    total: int
    page: int
    size: int


class AlvoResponse(BaseModel):
    """Uma sugestao do filtro "Tarefa ou projeto"."""

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


class ToggleResponse(BaseModel):
    """Um toggle da tela de preferencias."""

    model_config = {"from_attributes": True}

    type_group: str
    role: str
    enabled: bool
    #: Travado: sempre ligado, e o PUT recusa com 422.
    locked: bool


class PreferencesResponse(BaseModel):
    """Os toggles, na ordem da tela."""

    items: list[ToggleResponse]


class SetTogglePayload(BaseModel):
    """Liga ou desliga um toggle."""

    type_group: str
    role: str
    enabled: bool
