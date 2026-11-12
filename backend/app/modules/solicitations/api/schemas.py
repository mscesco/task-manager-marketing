"""Schemas de request/response do modulo de solicitacoes.

O request publico (sem credencial) tem limites defensivos por campo; o teto do
envio inteiro fica no servico (`MAX_CARACTERES_POR_ENVIO`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints


class AnswerItem(BaseModel):
    """Par pergunta/resposta exatamente como exibido no formulario."""

    # Mesmo teto do enunciado da pergunta (`QuestionCreateRequest`): o label e o enunciado.
    label: str = Field(min_length=1, max_length=300)
    value: str = Field(max_length=5000)


class SolicitationItemRequest(BaseModel):
    """Uma categoria preenchida dentro do envio."""

    category: str = Field(min_length=1, max_length=60)
    # O tamanho conta depois do strip: so espacos e vazio.
    summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]
    answers: list[AnswerItem] = Field(min_length=1, max_length=60)


class PublicSolicitationCreateRequest(BaseModel):
    """Um envio do formulario, com 1..11 categorias selecionadas.

    A ORDEM de `items` e a ordem em que o solicitante selecionou as
    categorias -- preservada em batch_seq.
    """

    workspace_slug: str = Field(min_length=1, max_length=120)
    #: De qual formulario veio o envio; conferido contra o workspace do slug no servico.
    form_id: uuid.UUID

    requester_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=255)
    ]
    requester_email: EmailStr
    # Opcionais aqui: quem decide se sao exigidos e o formulario, no servico.
    requester_phone: str | None = Field(default=None, max_length=50)
    requester_department: str | None = Field(default=None, max_length=255)
    requester_polo: str | None = Field(default=None, max_length=255)

    # Teto de payload; a regra fina por secao fica no servico.
    items: list[SolicitationItemRequest] = Field(min_length=1, max_length=60)

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
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    category: str
    summary: str
    answers: list[AnswerItem]
    status: str
    review_note: str | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    task_created_at: datetime | None
    task_ref: str | None
    #: A tarefa vinculada. `None` nas marcacoes antigas, que so tem `task_ref`.
    task_id: uuid.UUID | None = None
    created_at: datetime


# ---- Fila agrupada por ENVIO (visao principal da triagem) ----
class BatchItemResponse(BaseModel):
    """Uma demanda dentro do envio (o que se aprova/rejeita)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_seq: int
    category: str
    # Rotulos da secao, vindos do banco. `None` se a secao foi apagada: o front usa `category`.
    category_title: str | None = None
    category_emoji: str | None = None
    category_sla: str | None = None
    summary: str
    status: str
    answers: list[AnswerItem]
    review_note: str | None
    reviewed_at: datetime | None
    task_created_at: datetime | None
    task_ref: str | None
    #: A tarefa vinculada; `task_title` e resolvido na hora, nao gravado.
    task_id: uuid.UUID | None = None
    task_title: str | None = None


class BatchResponse(BaseModel):
    """Um card da fila: quem pediu + tudo que pediu de uma vez.

    Traz `answers` de cada item ja no card: o triador abre secao por secao
    sem um request por demanda (um envio de 4 categorias custaria 4 GETs).
    """

    batch_id: uuid.UUID
    protocol: str
    requester_name: str
    requester_email: str
    requester_phone: str | None
    requester_department: str | None
    requester_polo: str | None
    created_at: datetime
    #: Por qual formulario o envio entrou. `None` = pedido sem formulario.
    form_id: uuid.UUID | None = None
    form_title: str | None = None
    items: list[BatchItemResponse]


class FormOption(BaseModel):
    id: uuid.UUID
    title: str


class BatchListResponse(BaseModel):
    items: list[BatchResponse]
    total: int  # total de ENVIOS, nao de demandas
    page: int
    size: int
    #: Os numeros das abas, em demandas, com a mesma busca e formulario da lista:
    #: PENDING, ACTIVE, DONE, REJECTED, ALL, WITHOUT_TASK.
    tab_totals: dict[str, int] = Field(default_factory=dict)
    #: Os formularios que tem pedido nesta fila -- as opcoes do filtro.
    form_options: list[FormOption] = Field(default_factory=list)


class AndarRequest(BaseModel):
    """Corpo de `POST /solicitacoes/{id}/andamento`.

    Sem `Literal` nem validador: valor invalido e recusado no servico, porque
    validador custom aqui vira 500 em vez de 422.
    """

    status: str = Field(max_length=20)


class MarkTaskRequest(BaseModel):
    created: bool = True
    # Legado (texto livre das marcacoes antigas); use `task_id`.
    task_ref: str | None = Field(default=None, max_length=500)
    #: A tarefa vinculada; conferida contra o workspace no servico.
    task_id: uuid.UUID | None = None


class CriarTarefaRequest(BaseModel):
    """Corpo de `POST /solicitacoes/{id}/criar-tarefa`.

    So o quadro e escolha (`None` = quadro geral); o time vem do formulario.
    """

    board_id: uuid.UUID | None = None
    #: Responsaveis. Vazio = quem esta triando.
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)


class TarefaCriadaResponse(BaseModel):
    """A solicitacao ja vinculada e a tarefa que nasceu, para a tela oferecer "abrir"."""

    solicitacao: SolicitationResponse
    task_id: uuid.UUID
    task_title: str
