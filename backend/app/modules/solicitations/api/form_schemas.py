"""Schemas do formulario de solicitacao.

Sem `@model_validator` nem `Field(pattern=...)`: validador custom aqui vira 500
em vez de 422. Slug, tipo e opcoes sao recusados no `SolicitationFormService`.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, Field

#: Opcoes de uma pergunta; vao sem login no formulario publico, entao tem teto.
Opcoes = list[Annotated[str, Field(max_length=120)]]


class FormCreateRequest(BaseModel):
    """Corpo de `POST /solicitacoes/formularios`.

    Sem `is_published`: formulario nasce vazio e despublicado.
    """

    team_id: uuid.UUID
    slug: str = Field(max_length=60)
    title: str = Field(max_length=120)
    description: str = Field(default="", max_length=4000)


class FormUpdateRequest(BaseModel):
    """Sem `team_id`: mudar o time mudaria quem tria, inclusive os pedidos ja recebidos."""

    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    slug: str | None = Field(default=None, max_length=60)
    #: Rotulos da identificacao: aqui `null` desliga o campo (e nao "nao mexa").
    #: O router distingue pelo `model_fields_set`.
    phone_label: str | None = Field(default=None, max_length=60)
    department_label: str | None = Field(default=None, max_length=60)
    polo_label: str | None = Field(default=None, max_length=60)


class PublicarRequest(BaseModel):
    publicado: bool


class SectionCreateRequest(BaseModel):
    slug: str = Field(max_length=60)
    title: str = Field(max_length=120)
    emoji: str = Field(default="", max_length=16)
    #: Texto livre (ex.: "5 dias uteis apos aprovacao"), nao numero de dias.
    sla_text: str | None = Field(default=None, max_length=200)


class QuestionCreateRequest(BaseModel):
    label: str = Field(max_length=300)
    #: Um dos `QuestionKind`; a recusa e do servico.
    kind: str = Field(max_length=20)
    required: bool = False
    options: Opcoes = Field(default_factory=list, max_length=200)
    placeholder: str | None = Field(default=None, max_length=200)
    help: str | None = Field(default=None, max_length=300)


class SectionUpdateRequest(BaseModel):
    """Corpo de `PATCH /solicitacoes/secoes/{id}`.

    Sem `slug`: ele fica gravado em cada pedido e e por ele que a fila acha a
    categoria. Ver `SolicitationFormService.editar_secao`.
    """

    title: str | None = Field(default=None, max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    sla_text: str | None = Field(default=None, max_length=200)
    #: A pessoa preenche a secao mais de uma vez no envio.
    repeatable: bool | None = None
    #: "+ Adicionar outro <repeat_label>". Texto vazio limpa (volta ao titulo).
    repeat_label: str | None = Field(default=None, max_length=60)


class ResumoRequest(BaseModel):
    """Corpo de `POST /solicitacoes/secoes/{id}/resumo`.

    Rota propria porque limpar e mandar `null`, que num PATCH significa "nao mexe".
    """

    question_id: uuid.UUID | None = None


class QuestionUpdateRequest(BaseModel):
    """Corpo de `PATCH /solicitacoes/perguntas/{id}`. `options=None` e "nao mexe"."""

    label: str | None = Field(default=None, max_length=300)
    kind: str | None = Field(default=None, max_length=20)
    required: bool | None = None
    options: Opcoes | None = Field(default=None, max_length=200)
    placeholder: str | None = Field(default=None, max_length=200)
    help: str | None = Field(default=None, max_length=300)


class CondicionalRequest(BaseModel):
    """Corpo de `POST /solicitacoes/perguntas/{id}/condicional`.

    `alvo_id=None` desliga a condicional; qualquer alvo exige o `valor` que a dispara.
    """

    alvo_id: uuid.UUID | None = None
    valor: str | None = Field(default=None, max_length=200)


class OrdemRequest(BaseModel):
    """Corpo das duas rotas de reordenacao.

    A lista e o conjunto inteiro; o servico recusa se faltar ou sobrar id.
    """

    ids: list[uuid.UUID]


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
    repeatable: bool = False
    repeat_label: str | None = None
    questions: list[QuestionResponse] = Field(default_factory=list)


class FormResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    team_id: uuid.UUID
    slug: str
    title: str
    description: str
    is_published: bool
    #: `None` = o formulario nao pergunta este campo.
    phone_label: str | None = None
    department_label: str | None = None
    polo_label: str | None = None


class FormDetailResponse(FormResponse):
    """O formulario com a arvore de secoes e perguntas aninhada."""

    sections: list[SectionResponse] = Field(default_factory=list)
