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
    #: De qual formulario veio o envio (Spec 043, fatia B).
    #:
    #: ⚠️ OPCIONAL, E A AUSENCIA E COMPATIBILIDADE, nao descuido. Um cliente
    #: que ainda nao conheca o campo continua enviando -- e cai na validacao
    #: antiga, contra a lista fixa de categorias do dominio. Torna-lo
    #: obrigatorio de uma vez quebraria qualquer aba aberta no momento do
    #: deploy, numa rota que nao tem login para avisar ninguem.
    #:
    #: ⚠️ E ELE E CONFERIDO CONTRA O WORKSPACE DO SLUG. Aceitar um `form_id`
    #: qualquer deixaria alguem pendurar solicitacao no formulario de outro
    #: cliente -- ver `SolicitationService.create_public`.
    form_id: uuid.UUID | None = None

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
    items: list[BatchItemResponse]


class BatchListResponse(BaseModel):
    items: list[BatchResponse]
    total: int  # total de ENVIOS, nao de demandas
    page: int
    size: int
    pending_total: int
    approved_without_task_total: int


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
