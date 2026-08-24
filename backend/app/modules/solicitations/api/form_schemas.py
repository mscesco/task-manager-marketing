"""Schemas do formulario de solicitacao (Spec 043, fatia A).

⚠️ SEM `@model_validator` E SEM `Field(pattern=...)` EM NENHUM DELES. Regra de
request neste projeto NAO mora no Pydantic: o `_validation_error_handler` poe
`exc.errors()` cru no envelope, e o `ctx` de um validador custom carrega o
objeto `ValueError`, que o `json.dumps` do Starlette recusa -- sai **500, nao
422** (medido em 10/08). Slug, tipo de pergunta e opcoes sao recusados no
`SolicitationFormService`, com `ValidationError` de dominio.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class FormCreateRequest(BaseModel):
    """Corpo de `POST /solicitacoes/formularios`.

    ⚠️ `is_published` NAO ENTRA, e a ausencia e a regra: formulario nasce
    vazio, e publicado na criacao ele seria uma porta que nao pergunta nada.
    Ver `SolicitationFormService.criar_formulario`.
    """

    team_id: uuid.UUID
    slug: str = Field(max_length=60)
    title: str = Field(max_length=120)
    description: str = Field(default="", max_length=4000)


class FormUpdateRequest(BaseModel):
    """⚠️ `team_id` NAO ENTRA. Mudar o time e mudar QUEM TRIA -- inclusive as
    solicitacoes que ja chegaram, porque a fila as encontra pelo time do
    formulario. Operacao de visibilidade disfarcada de edicao, mesmo motivo
    pelo qual `BoardRenameRequest` recusa o campo."""

    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    slug: str | None = Field(default=None, max_length=60)


class PublicarRequest(BaseModel):
    publicado: bool


class SectionCreateRequest(BaseModel):
    slug: str = Field(max_length=60)
    title: str = Field(max_length=120)
    emoji: str = Field(default="", max_length=16)
    #: ⚠️ TEXTO LIVRE, e nao numero de dias -- o formulario de hoje diz coisas
    #: como "5 dias uteis apos aprovacao" e "prazo em definicao".
    sla_text: str | None = Field(default=None, max_length=200)


class QuestionCreateRequest(BaseModel):
    label: str = Field(max_length=300)
    #: Um dos `QuestionKind`. A recusa e do dominio -- ver o topo do modulo.
    kind: str = Field(max_length=20)
    required: bool = False
    options: list[str] = Field(default_factory=list)
    placeholder: str | None = Field(default=None, max_length=200)
    help: str | None = Field(default=None, max_length=300)


class QuestionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    section_id: uuid.UUID
    label: str
    kind: str
    required: bool
    options: list[str]
    placeholder: str | None
    help: str | None
    show_if_question_id: uuid.UUID | None
    show_if_value: str | None
    position: int


class SectionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    slug: str
    title: str
    emoji: str
    sla_text: str | None
    summary_question_id: uuid.UUID | None
    position: int
    questions: list[QuestionResponse] = Field(default_factory=list)


class FormResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    team_id: uuid.UUID
    slug: str
    title: str
    description: str
    is_published: bool


class FormDetailResponse(FormResponse):
    """O formulario com a arvore montada.

    ⚠️ ANINHADO, e nao lista plana com `section_id`: quem monta a tela precisa
    da arvore, e devolver plano faria cada cliente reagrupar -- o primeiro que
    agrupasse errado desenharia pergunta na secao errada, sem erro nenhum.
    """

    sections: list[SectionResponse] = Field(default_factory=list)
