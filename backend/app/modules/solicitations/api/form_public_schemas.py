"""Schemas da leitura publica do formulario.

Menores que os autenticados de proposito: `team_id`, `created_by` e
`is_published` nao saem daqui. Nao reaproveite os schemas autenticados.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class PublicFormResumo(BaseModel):
    """Uma linha da lista publica de formularios."""

    slug: str
    title: str
    description: str
    #: Nome (e nao o id) do time dono, para agrupar a lista.
    team_name: str


class PublicQuestion(BaseModel):
    """Uma pergunta, como o formulario publico precisa dela."""

    id: uuid.UUID
    label: str
    kind: str
    required: bool
    options: list[str]
    placeholder: str | None
    help: str | None
    #: Id da pergunta de que esta depende; o cliente compara com o valor respondido.
    show_if_question_id: uuid.UUID | None
    show_if_value: str | None


class PublicSection(BaseModel):
    slug: str
    title: str
    emoji: str
    sla_text: str | None
    #: Qual resposta vira o resumo na fila de triagem (o cliente monta o `summary`).
    summary_question_id: uuid.UUID | None
    #: A pessoa pode preencher a secao mais de uma vez no envio.
    repeatable: bool = False
    repeat_label: str | None = None
    questions: list[PublicQuestion] = Field(default_factory=list)


class PublicFormDetail(BaseModel):
    """O formulario inteiro, pronto para desenhar."""

    id: uuid.UUID
    slug: str
    title: str
    description: str
    # Rotulos da identificacao: `None` = o formulario nao pergunta este campo.
    phone_label: str | None = None
    department_label: str | None = None
    polo_label: str | None = None
    sections: list[PublicSection] = Field(default_factory=list)
