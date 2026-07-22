"""Schemas de request/response do modulo de solicitacoes.

O request PUBLICO tem limites defensivos rigorosos: e a unica
porta da API alcancavel sem credencial. Limites (60 respostas,
label 200, valor 5000) comportam com folga a maior ramificacao
do formulario e cortam payload abusivo.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AnswerItem(BaseModel):
    """Par pergunta/resposta exatamente como exibido no formulario."""

    label: str = Field(min_length=1, max_length=200)
    value: str = Field(max_length=5000)


class SolicitationItemRequest(BaseModel):
    """Uma categoria preenchida dentro do envio."""

    category: str = Field(min_length=1, max_length=60)
    summary: str = Field(min_length=1, max_length=500)
    answers: list[AnswerItem] = Field(min_length=1, max_length=60)


class PublicSolicitationCreateRequest(BaseModel):
    """Um envio do formulario, com 1..11 categorias selecionadas.

    A ORDEM de `items` e a ordem em que o solicitante selecionou as
    categorias -- preservada em batch_seq.
    """

    workspace_slug: str = Field(min_length=1, max_length=120)

    requester_name: str = Field(min_length=2, max_length=255)
    requester_email: EmailStr
    requester_phone: str = Field(min_length=8, max_length=50)
    requester_department: str = Field(min_length=1, max_length=255)
    requester_polo: str = Field(min_length=1, max_length=255)

    # Teto = tamanho do menu (11). Nao ha o que selecionar alem disso.
    items: list[SolicitationItemRequest] = Field(min_length=1, max_length=11)

    # Honeypot anti-bot: input invisivel no form. Humano nao preenche.
    website: str = Field(default="", max_length=200)


class PublicSolicitationCreateResponse(BaseModel):
    """Resposta ao solicitante: protocolo do LOTE + quantas entraram."""

    protocol: str
    created: int


class ReviewRequest(BaseModel):
    # Obrigatoria na rejeicao (validado no service); opcional na aprovacao.
    note: str | None = Field(default=None, max_length=2000)


class SolicitationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_id: uuid.UUID
    batch_seq: int
    batch_total: int
    requester_name: str
    requester_email: str
    requester_phone: str
    requester_department: str
    requester_polo: str
    category: str
    summary: str
    answers: list[AnswerItem]
    status: str
    review_note: str | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    task_created_at: datetime | None
    task_ref: str | None
    created_at: datetime


# ---- Fila agrupada por ENVIO (visao principal da triagem) ----
class BatchItemResponse(BaseModel):
    """Uma demanda dentro do envio (o que se aprova/rejeita)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_seq: int
    category: str
    summary: str
    status: str
    answers: list[AnswerItem]
    review_note: str | None
    reviewed_at: datetime | None
    task_created_at: datetime | None
    task_ref: str | None


class BatchResponse(BaseModel):
    """Um card da fila: quem pediu + tudo que pediu de uma vez.

    Traz `answers` de cada item ja no card: o triador abre secao por secao
    sem um request por demanda (um envio de 4 categorias custaria 4 GETs).
    """

    batch_id: uuid.UUID
    protocol: str
    requester_name: str
    requester_email: str
    requester_phone: str
    requester_department: str
    requester_polo: str
    created_at: datetime
    items: list[BatchItemResponse]


class BatchListResponse(BaseModel):
    items: list[BatchResponse]
    total: int  # total de ENVIOS, nao de demandas
    page: int
    size: int
    pending_total: int
    approved_without_task_total: int


class MarkTaskRequest(BaseModel):
    created: bool = True
    # Link ou identificador da tarefa criada no quadro. Texto livre porque
    # a criacao e manual -- nao ha id garantido pra validar.
    task_ref: str | None = Field(default=None, max_length=500)
