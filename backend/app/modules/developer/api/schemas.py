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
