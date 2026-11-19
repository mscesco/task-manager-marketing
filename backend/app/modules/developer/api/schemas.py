"""Schemas das chaves de API (Spec 065)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    #: O começo da chave, para reconhecer qual é.
    prefix: str
    read_only: bool
    expires_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


class ApiKeyCreatedResponse(ApiKeyResponse):
    #: A chave inteira. Só aparece nesta resposta.
    key: str


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    read_only: bool = True
    #: Dias de validade; `null` = sem validade.
    days: Literal[30, 90, 365] | None = 90


WebhookEvent = Literal[
    "task.created", "task.moved", "solicitation.created", "solicitation.status_changed"
]


class WebhookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    team_id: uuid.UUID
    board_id: uuid.UUID | None
    events: list[str]
    is_active: bool
    consecutive_failures: int
    created_at: datetime


class WebhookCreatedResponse(WebhookResponse):
    #: Chave da assinatura (`X-TM-Signature`). Só aparece nesta resposta.
    secret: str


class WebhookCreateRequest(BaseModel):
    url: str = Field(min_length=9, max_length=500)
    team_id: uuid.UUID
    board_id: uuid.UUID | None = None
    events: list[WebhookEvent] = Field(min_length=1)


class WebhookUpdateRequest(BaseModel):
    url: str | None = Field(None, min_length=9, max_length=500)
    events: list[WebhookEvent] | None = Field(None, min_length=1)
    #: `true` religa e zera a conta de falhas.
    is_active: bool | None = None


class WebhookDeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event: str
    status_code: int | None
    error: str | None
    duration_ms: int
    delivered_at: datetime
