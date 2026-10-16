"""Schemas de request/response do modulo de solicitacoes.

O request PUBLICO tem limites defensivos rigorosos: e a unica
porta da API alcancavel sem credencial. Limites (60 respostas,
label 300, valor 5000) comportam com folga a maior ramificacao
do formulario e cortam payload abusivo. O teto do ENVIO INTEIRO e do
servico (`MAX_CARACTERES_POR_ENVIO`): por campo, 60 x 60 x 5000 ainda
dava ~19 MB por POST.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AnswerItem(BaseModel):
    """Par pergunta/resposta exatamente como exibido no formulario."""

    # ⚠️ O MESMO TETO DO ENUNCIADO DA PERGUNTA (`form_schemas.QuestionCreateRequest`,
    # 300): o label E o enunciado. Com 200, pergunta de 201 a 300 caracteres
    # travava o envio inteiro com 422, numa rota sem login para avisar alguem.
    label: str = Field(min_length=1, max_length=300)
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
    #: De qual formulario veio o envio (Spec 043, fatia B).
    #:
    #: ⚠️ OBRIGATORIO DESDE 16/10 (auditoria). Era opcional para a aba aberta
    #: durante o deploy da Spec 043 (agosto) nao levar 422 -- e esse motivo ja
    #: passou, mas a porta ficou: qualquer um criava pedido ORFAO, sem o
    #: cabecalho do formulario e visivel na fila da organizacao inteira. O
    #: front manda sempre (`web/lib/api.ts`). O SERVICO ainda trata pedido sem
    #: formulario (ha pedidos assim no banco, de antes da 043).
    #:
    #: ⚠️ E ELE E CONFERIDO CONTRA O WORKSPACE DO SLUG. Aceitar um `form_id`
    #: qualquer deixaria alguem pendurar solicitacao no formulario de outro
    #: cliente -- ver `SolicitationService.create_public`.
    form_id: uuid.UUID

    requester_name: str = Field(min_length=2, max_length=255)
    requester_email: EmailStr
    # ⚠️ OS TRES VIRARAM OPCIONAIS NO SCHEMA (Spec 043, fatia G), e a
    # obrigatoriedade mudou de lugar: quem decide se sao exigidos e o
    # FORMULARIO, no servico. Um `min_length` aqui recusaria antes de o
    # servidor sequer saber por qual porta o pedido entrou -- e o formulario de
    # TI, que nao pergunta polo, levaria 422 em toda submissao.
    #
    # ⚠️ E `requester_name`/`requester_email` CONTINUAM COM `min_length` acima:
    # eles nao sao configuraveis, porque a fila e organizada por quem pediu e a
    # resposta automatica precisa do endereco.
    requester_phone: str | None = Field(default=None, max_length=50)
    requester_department: str | None = Field(default=None, max_length=255)
    requester_polo: str | None = Field(default=None, max_length=255)

    # Teto de payload. ⚠️ DEIXOU DE SER O TAMANHO DO MENU (11) com a secao
    # repetivel (Spec 059): a regra fina (20 por secao) e do servico.
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
    #: A tarefa vinculada (Spec 043, fatia E). `None` em tudo que foi marcado
    #: antes desta fatia -- essas guardam so o `task_ref` de texto livre.
    task_id: uuid.UUID | None = None
    created_at: datetime


# ---- Fila agrupada por ENVIO (visao principal da triagem) ----
class BatchItemResponse(BaseModel):
    """Uma demanda dentro do envio (o que se aprova/rejeita)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_seq: int
    category: str
    # ⚠️ O ROTULO VEM DO BANCO, E ANTES VINHA DE UM ARQUIVO NO FRONT.
    # `web/lib/solicitacaoForm.ts` mapeava slug -> titulo/emoji, e funcionava
    # so porque a migration 0017 copiou os mesmos slugs. A primeira secao
    # criada pelo editor apareceria na fila como slug cru e "❓".
    #
    # ⚠️ `None` E LEGITIMO: secao apagada, ou pedido de uma categoria que nao
    # existe mais. O front cai no `category` cru -- que e o que ele ja fazia.
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
    #: A tarefa vinculada (Spec 043, fatia E), e o titulo dela para a tela
    #: mostrar um link legivel em vez de um uuid.
    #:
    #: ⚠️ `task_title` E RESOLVIDO NA HORA, e nao gravado: renomear a tarefa
    #: no quadro arruma o link na fila. Mesma regra do rotulo da categoria.
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
    #: Por qual formulario o envio entrou. `None` = pedido de antes da Spec
    #: 043, sem formulario.
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
    pending_total: int
    approved_without_task_total: int
    #: Os numeros das abas (15/10), em demandas, com a mesma busca e o mesmo
    #: formulario da lista: PENDING, ACTIVE, DONE, REJECTED, ALL, WITHOUT_TASK.
    tab_totals: dict[str, int] = Field(default_factory=dict)
    #: Os formularios que tem pedido nesta fila -- as opcoes do filtro.
    form_options: list[FormOption] = Field(default_factory=list)


class AndarRequest(BaseModel):
    """Corpo de `POST /solicitacoes/{id}/andamento` (Spec 043, fatia D).

    ⚠️ SEM `Literal` E SEM VALIDADOR: valor fora do conjunto e recusado no
    servico, com `ValidationError` de dominio. Validador custom neste projeto
    devolve **500 no lugar de 422** -- o `_validation_error_handler` poe
    `exc.errors()` cru no envelope, e o `ctx` carrega o `ValueError`, que o
    `json.dumps` do Starlette recusa (medido em 10/08).
    """

    status: str = Field(max_length=20)


class MarkTaskRequest(BaseModel):
    created: bool = True
    # Link ou identificador da tarefa criada no quadro. Texto livre porque
    # a criacao e manual -- nao ha id garantido pra validar.
    #
    # ⚠️ LEGADO A PARTIR DA FATIA E: use `task_id`. Este campo fica porque as
    # marcacoes antigas moram nele como texto, e nao ha como converte-las.
    task_ref: str | None = Field(default=None, max_length=500)
    #: A tarefa DE VERDADE (Spec 043, fatia E).
    #:
    #: ⚠️ CONFERIDA CONTRA O WORKSPACE no servico: a FK composta ja impediria
    #: apontar para outro cliente, mas o erro viria do banco como violacao de
    #: integridade -- feio e sem explicacao.
    task_id: uuid.UUID | None = None


class CriarTarefaRequest(BaseModel):
    """Corpo de `POST /solicitacoes/{id}/criar-tarefa`.

    ⚠️ SO O QUADRO E ESCOLHA. O time vem do FORMULARIO por onde o pedido
    entrou -- deixar quem tria escolher faria a tarefa nascer longe de quem vai
    faze-la sempre que um ADMIN triasse a fila de outra equipe.

    ⚠️ E `None` E O QUADRO GERAL, o mesmo contrato do `CreateTaskCommand`.
    """

    board_id: uuid.UUID | None = None
    #: Quem fica responsável. Vazio = quem está triando.
    #:
    #: ⚠️ TODA TAREFA PRECISA DE AO MENOS UM RESPONSÁVEL neste produto, e o
    #: padrão ser quem tria é a única opção honesta: é a pessoa que acabou de
    #: aceitar o pedido, e portanto quem responde por ele até repassar.
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)


class TarefaCriadaResponse(BaseModel):
    """A solicitacao ja vinculada, MAIS o id da tarefa que nasceu.

    ⚠️ OS DOIS NA MESMA RESPOSTA para a tela poder oferecer "abrir a tarefa"
    sem um segundo request -- e o passo seguinte natural de quem acabou de
    criar uma.
    """

    solicitacao: SolicitationResponse
    task_id: uuid.UUID
    task_title: str
