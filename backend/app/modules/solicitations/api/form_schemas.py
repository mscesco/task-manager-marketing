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
    #: Rotulos da identificacao: `null` DESLIGA o campo, texto liga e renomeia.
    #:
    #: ⚠⚠ AQUI `null` SIGNIFICA "DESLIGUE", e nao "nao mexa" -- o oposto
    #: dos campos acima. Quem distingue os dois e o `model_fields_set` do
    #: Pydantic, que sabe quais chaves vieram no corpo; o router so aplica o
    #: que foi enviado.
    #:
    #: Tentei antes com uma SENTINELA (um valor "impossivel" como default) e
    #: foi um erro em dois niveis: o valor escolhido gravou um caractere de
    #: controle literal no arquivo-fonte, e mesmo corrigido ele seria um texto
    #: que alguem um dia conseguiria digitar. `model_fields_set` e a resposta
    #: que o Pydantic ja dava.
    phone_label: str | None = Field(default=None, max_length=60)
    department_label: str | None = Field(default=None, max_length=60)
    polo_label: str | None = Field(default=None, max_length=60)


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


class SectionUpdateRequest(BaseModel):
    """Corpo de `PATCH /solicitacoes/secoes/{id}`.

    ⚠️ **NAO TEM `slug`, E A AUSENCIA E A REGRA.** O slug da secao viaja
    gravado em cada pedido (`solicitation_item.category`) e e por ele que a
    fila descobre a categoria. Troca-lo deixaria todo pedido antigo aparecendo
    como texto cru, sem titulo e sem emoji -- sem erro nenhum. Titulo e emoji
    podem mudar justamente porque NAO sao gravados. O motivo inteiro esta em
    `SolicitationFormService.editar_secao`.
    """

    title: str | None = Field(default=None, max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    sla_text: str | None = Field(default=None, max_length=200)


class ResumoRequest(BaseModel):
    """Corpo de `POST /solicitacoes/secoes/{id}/resumo`.

    ⚠️ ROTA PROPRIA E NAO CAMPO DO `PATCH`: limpar o resumo e mandar `null`, e
    num PATCH `null` se confunde com "nao mexe neste campo".
    """

    question_id: uuid.UUID | None = None


class QuestionUpdateRequest(BaseModel):
    """Corpo de `PATCH /solicitacoes/perguntas/{id}`.

    ⚠️ `options=None` E "NAO MEXE", e nao "esvazia". Quem so quis corrigir uma
    vírgula no titulo nao pode perder a lista de alternativas por omissao.
    """

    label: str | None = Field(default=None, max_length=300)
    kind: str | None = Field(default=None, max_length=20)
    required: bool | None = None
    options: list[str] | None = None
    placeholder: str | None = Field(default=None, max_length=200)
    help: str | None = Field(default=None, max_length=300)


class CondicionalRequest(BaseModel):
    """Corpo de `POST /solicitacoes/perguntas/{id}/condicional`.

    ⚠️ OS DOIS CAMPOS ANDAM JUNTOS: `alvo_id=None` desliga a condicional, e
    qualquer alvo exige o `valor` que o dispara. Deixa-los num `PATCH` faria
    "desligar" e "nao mexer" virarem o mesmo corpo.
    """

    alvo_id: uuid.UUID | None = None
    valor: str | None = Field(default=None, max_length=200)


class OrdemRequest(BaseModel):
    """Corpo das duas rotas de reordenacao.

    ⚠️ A LISTA E O CONJUNTO INTEIRO, e o servico recusa se faltar ou sobrar
    um id. Aceitar lista parcial deixaria uma aba velha, aberta desde antes de
    alguem criar uma secao, sobrescrever a ordem com um mundo que nao existe
    mais.
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
    questions: list[QuestionResponse] = Field(default_factory=list)


class FormResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    team_id: uuid.UUID
    slug: str
    title: str
    description: str
    is_published: bool
    #: `None` = o formulario nao pergunta este campo (Spec 043, fatia G).
    phone_label: str | None = None
    department_label: str | None = None
    polo_label: str | None = None


class FormDetailResponse(FormResponse):
    """O formulario com a arvore montada.

    ⚠️ ANINHADO, e nao lista plana com `section_id`: quem monta a tela precisa
    da arvore, e devolver plano faria cada cliente reagrupar -- o primeiro que
    agrupasse errado desenharia pergunta na secao errada, sem erro nenhum.
    """

    sections: list[SectionResponse] = Field(default_factory=list)
