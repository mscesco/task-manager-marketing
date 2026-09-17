"""Schemas (DTOs) de request/response do modulo tasks.

Contem schemas de Project (Entrega 1) e Task (Entrega 2).

NOTAS de design:
    - created_by NAO aparece em Create/Update -- e imutavel.
    - ⚠️ `is_personal` SAIU DO SCHEMA em 10/09, com o projeto pessoal.
      Era campo de resposta, entao a remocao e MUDANCA DE CONTRATO: o
      front lia `is_personal` em oito lugares para nao OFERECER pessoal
      nos seletores de projeto, e os oito sairam no mesmo commit.
    - Validacao cruzada (start_date <= due_date) vive no service,
      sobre o estado RESULTANTE do PATCH.
    - Em Task, project_id e parent_task_id NAO entram em
      TaskUpdateRequest -- usar /tasks/{id}/move.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from enum import Enum

from pydantic import BaseModel, Field, computed_field

from app.core.tenant import current_tenant
from app.db.models.enums import (
    ColumnSemantic,
    PriorityLevel,
    ProjectStatus,
    TaskStatus,
)

# Limite defensivo para description -- generoso, mas evita uploads
# acidentais de Mb de texto.
_DESCRIPTION_MAX = 100_000


def _pode_no_time(permission: str, team_id: uuid.UUID | None) -> bool:
    """O cadeado de um item, pela MESMA pergunta do servico. Spec 051, fatia A.

    ⚠️⚠️ POR QUE NO SCHEMA, e nao no router como o `can_update` de `GET /teams`:
    tarefa e projeto saem por MUITAS rotas (quadro, lista, detalhe, minhas
    tarefas, arquivadas, criar, editar, mover...). Um campo montado no router
    teria de ser lembrado em cada uma, e a rota esquecida devolveria a tarefa
    sem cadeado -- ou com um default que mente. Aqui o campo sai onde o item sai.

    ⚠️ E PURO: le o contexto da requisicao, nao o banco. Sem N+1 numa pagina
    de 173 tarefas.

    ⚠️ SEM CONTEXTO (serializacao fora de requisicao) responde False: o campo
    diz "mostre o botao", e na duvida o botao nao aparece -- o servidor recusa
    de qualquer jeito.
    """
    tenant = current_tenant()
    return tenant is not None and tenant.has_permission_in(permission, team_id)


# =========================================================
# PROJECT (Entrega 1)
# =========================================================
class ProjectResponse(BaseModel):
    """Representacao de um projeto na API."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    description: str
    status: ProjectStatus
    priority: PriorityLevel
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    is_archived: bool
    team_id: uuid.UUID | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    # ⚠️ Spec 051, fatia A: os botoes do projeto vem daqui, e nao do `/auth/me`
    # -- que diz "o que", nunca "onde". Quem e MANAGER no Marketing e OPERATOR
    # no Comercial VE o projeto do Comercial e nao mexe nele. Mesmas perguntas
    # de `ProjectService._assert_verbo_no_time`.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update(self) -> bool:
        return _pode_no_time("project.update", self.team_id)

    # ⚠️ `can_archive` SAIU EM 17/09/2026, junto com as rotas de arquivar
    # projeto: era o cadeado de um botao sem rota.

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return _pode_no_time("project.delete", self.team_id)


class ProjectCreateRequest(BaseModel):
    """Criacao de projeto. workspace_id e created_by sao internos --
    nunca vem do cliente."""

    title: str = Field(min_length=1, max_length=255)
    team_id: uuid.UUID  # Entrega 3: time dono (obrigatorio em comum).
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


class ProjectUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    `created_by` ausente por design -- imutavel.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


class LinkIn(BaseModel):
    """Um link a gravar (Spec 052, fatia B).

    ⚠️ Os limites daqui sao so a primeira barreira contra payload inflado; a
    regra de verdade (nome nao vazio depois de aparar, `http`/`https`, ate 20)
    mora em `link_service.validar_links`, com a mensagem que a tela mostra.
    """

    title: str = Field(max_length=500)
    url: str = Field(max_length=4096)


class LinksReplaceRequest(BaseModel):
    """A lista INTEIRA de links do item, na ordem -- substitui a atual."""

    links: list[LinkIn] = Field(max_length=100)


class LinkResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    title: str
    url: str


class ProjectListResponse(BaseModel):
    """Pagina de projetos."""

    items: list[ProjectResponse]
    total: int
    page: int
    size: int


# =========================================================
# TASK (Entrega 2)
# =========================================================
class TaskResponse(BaseModel):
    """Representacao de uma task na API.

    ⚠️ `board_id` e `column_id` entraram na Spec 036, fatia 3, e sao o que
    torna a fatia 4 construivel: sem eles o front recebe a lista de colunas
    (`GET /boards`) e nao sabe em qual desenhar cada card.

    ⚠️ `semantic` e `notify_deadline` da coluna NAO entram aqui, e isso e
    decisao, nao esquecimento. Eles ja viajam em `BoardColumnResponse` pelo
    `GET /boards` -- o front busca o catalogo de colunas UMA vez e cruza por
    `column_id`. Repeti-los em cada task criaria uma segunda fonte de verdade
    para o mesmo dado, e a fatia 5 (renomear coluna, mudar semantica) teria de
    invalidar as duas.

    ⚠️ O NOME DO QUADRO tambem NAO entra, pelo mesmo argumento: `board_id` ->
    nome resolve no cliente com o `/boards` que ele ja tem. O selo da ADR 0034
    (item 6) sai de graca. A versao com o nome cravado aqui desatualiza no dia
    em que a fatia 5 permitir renomear quadro.

    ⚠️ NAO EXISTE VAZAMENTO DE `board_id` HOJE, e o motivo e estrutural:
    `BoardRepository.default_board_and_column_for_status` resolve o quadro de
    toda task nova com `JOIN team ... AND t.parent_team_id IS NULL` (ADR 0032),
    entao `board.team_id` e SEMPRE a raiz -- que todo mundo alcanca. Quem
    enxerga a task enxerga o quadro. **O portao para o dia em que isso deixar
    de valer mora na fatia 5**, naquela funcao, e nao neste schema.
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    parent_task_id: uuid.UUID | None
    team_id: uuid.UUID | None
    board_id: uuid.UUID
    column_id: uuid.UUID
    title: str
    description: str
    status: TaskStatus
    priority: PriorityLevel
    position: int
    depth: int
    path: str
    start_date: date | None
    due_date: date | None
    # Spec 038, fatia B: a HORA do prazo. `None` = "vence no dia" -- o
    # comportamento de sempre. ⚠️ Hora SEM data e recusada pelo service (422):
    # hora sozinha nao situa nada, e o `due_time` viraria dado orfao.
    due_time: time | None
    completed_at: datetime | None
    is_archived: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    # ⚠️ Spec 051, fatia A: "Excluir" a tarefa E moderar comentario alheio nela
    # -- as duas perguntas sao `task.delete` no time da tarefa
    # (`TaskService.soft_delete`, `CommentService.delete_comment`).
    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return _pode_no_time("task.delete", self.team_id)


class DeleteTaskResponse(TaskResponse):
    """Resposta do DELETE -- inclui contagem de filhas apagadas (ADR 0005)."""

    cascade_count: int


class ArchiveTaskResponse(TaskResponse):
    """Resposta de archive/unarchive -- inclui a contagem da cascata (05/08).

    ⚠️ A contagem existe para a TELA AVISAR. Arquivar um pai mexe em tarefas
    que a pessoa nao citou; sem o aviso ela so descobriria pela ausencia
    delas, dias depois. Mesma razao do `promoted_to_root` na duplicacao.
    """

    cascade_count: int


class TaskCreateRequest(BaseModel):
    """Criacao de task. workspace_id, created_by, path e depth sao
    internos -- nunca vem do cliente."""

    title: str = Field(min_length=1, max_length=255)
    project_id: uuid.UUID | None = None  # Entrega 3: opcional -> avulsa.
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    # Spec 036, fatia 5b-6: em QUAL quadro a tarefa de topo nasce.
    #
    # ⚠️ `None` = Quadro geral, que e o comportamento de sempre e o de 100% das
    # tarefas ate aqui. So a tela do time preenche, e so para quadro avulso.
    #
    # ⚠️ IGNORADO EM SUBTAREFA -- filha herda o quadro do PAI (ADR 0024).
    # Aceitar os dois abriria pai num quadro e filha em outro, sem erro e sem
    # tela.
    #
    # ⚠️ NAO E CONFIAVEL SO POR ESTAR TIPADO. `TaskService._assert_board_in_reach`
    # confere que o quadro esta na lente de quem escreve; sem ela, montar este
    # JSON na mao cria tarefa no quadro de um subtime alheio -- e quadro decide
    # QUEM VE (ADR 0035 D3).
    board_id: uuid.UUID | None = None
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None
    # Spec 038, fatia B: a HORA do prazo. `None` = "vence no dia" -- o
    # comportamento de sempre. ⚠️ Hora SEM data e recusada pelo service (422):
    # hora sozinha nao situa nada, e o `due_time` viraria dado orfao.
    due_time: time | None = None
    # Spec 021: 0+ responsaveis ja na criacao. Vazio = sem responsavel
    # (comportamento anterior). Validacao (alcance/ativo/monouser) e atomica
    # no service: qualquer invalido -> 422 listando todos, nada criado.
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)
    # Spec 053, fatia B (D6): seguidores ja na criacao. Mesma forma do
    # `assignee_ids`: atomico, invalido -> 422 com `invalid_ids`, nada criado.
    # ⚠️ PRECISA DE LINHA NO ROUTER -- o Pydantic aceita o campo e o command
    # tem default [], entao sem a linha ele some em silencio.
    watcher_ids: list[uuid.UUID] = Field(default_factory=list)


class TaskUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    project_id e parent_task_id NAO entram aqui -- usar
    POST /tasks/{id}/move.

    ⚠️ `status` e `column_id` sao MUTUAMENTE EXCLUSIVOS (ADR 0041, D3). Os dois
    escrevem a mesma dupla (status, coluna) por caminhos opostos.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    # Spec 038, fatia B: a HORA do prazo. `None` = "vence no dia" -- o
    # comportamento de sempre. ⚠️ Hora SEM data e recusada pelo service (422):
    # hora sozinha nao situa nada, e o `due_time` viraria dado orfao.
    due_time: time | None = None
    # ⚠️ ADR 0041. A coluna tem de ser do quadro DA TAREFA -- quem confere e o
    # service (`BoardRepository.coluna_no_quadro`), porque o schema nao tem
    # sessao de banco. O status resultante e DERIVADO dela.
    #
    # ⚠️ A EXCLUSAO MUTUA COM `status` NAO MORA AQUI, e a tentativa foi MEDIDA:
    # um `@model_validator` que levanta `ValueError` faz o endpoint devolver
    # **500, nao 422**. O `_validation_error_handler` poe `exc.errors()` cru no
    # envelope, e o `ctx` de um validador custom carrega o proprio objeto
    # `ValueError`, que o `json.dumps` do Starlette nao serializa. A regra
    # ficou no ROUTER, com a `ValidationError` de dominio -- mesmo caminho de
    # todas as outras regras deste projeto. Ver o item pendente sobre o
    # handler.
    column_id: uuid.UUID | None = None


class TaskMoveRequest(BaseModel):
    """Move pra novo pai e/ou projeto. Pelo menos um dos dois.

    No-op silencioso se nada muda no final.

    Spec 022: `detach_project=True` tira a task de projeto (avulsa). Nao combina
    com project_id/parent_task_id; so vale em task de topo.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    detach_project: bool = False


class TaskListItem(TaskResponse):
    """Item da listagem do quadro: TaskResponse + responsaveis (so IDs).

    assignee_ids vem em LOTE (1 query pra pagina inteira) -- alimenta o selo
    do card sem N+1. Supera a "decisao 9" original (lista enxuta) porque o
    quadro precisa mostrar quem e responsavel de relance (Entrega 10 / ADR
    0025). watcher_ids segue FORA da lista (so no detalhe).

    ⚠️ SPEC 042 -- OS TRES CAMPOS ABAIXO EXISTEM PARA O QUADRO PARAR DE
    CARREGAR SUBTAREFA. Medido em 19/08/2026: 917 tarefas carregadas contra o
    teto de 1000, **670 delas subtarefa**, para desenhar 170 cards. Subtarefa
    nao desenha card (`depth === 0`), mas era carregada porque o front precisa
    dela para tres coisas. Estes campos entregam duas; a terceira (busca por
    titulo de descendente) virou parametro na listagem.

    Mesmo desenho do `assignee_ids`: uma query em LOTE para a pagina inteira,
    anexada no router depois da listagem. Nunca uma consulta por card.
    """

    assignee_ids: list[uuid.UUID] = []

    #: Filhas DIRETAS vivas. ⚠️ Arquivada fica de fora do numerador E do
    #: denominador -- a checklist responde "quanto falta do trabalho vivo", e
    #: contar o que saiu do fluxo faria a barra CAIR quando alguem arquiva.
    #: Filha so arquivada da 0, e a tela nao desenha contador nem barra.
    subtask_total: int = 0

    #: Filhas diretas vivas em coluna de semantica `DONE`.
    #: ⚠️ Conta pela COLUNA e nao por `status`, e `DONE` e nao terminal
    #: (cancelada NAO e entregue). As duas regras vieram de defeito na tela --
    #: ver `domain/subtask_progress.py`, que e a fonte da verdade.
    subtask_done: int = 0

    #: Responsaveis da SUBARVORE INTEIRA, raiz incluida. Alimenta o filtro por
    #: pessoa, que precisa achar a raiz quando a designacao esta na subtarefa
    #: -- o caso comum: a raiz e a campanha, a pessoa toca uma peca dela.
    #: ⚠️ Nao ha campo de subtime: o front deriva o subtime a partir DESTES ids
    #: com o mapa de membros que ele ja carrega, que e o que ele faz hoje.
    subtree_assignee_ids: list[uuid.UUID] = []


class TaskDuplicateRequest(BaseModel):
    """Duplicacao (Spec 033). Os campos ja revisados no modal.

    ⚠️ NAO TEM CAMPO DE DATA, e isso e a D5 defendida na fronteira da API.
    Um `due_date` aqui e o front acaba mandando: a copia nasce com o prazo
    velho, ja vencida, e o job de prazo dispara TASK_OVERDUE em lote na
    primeira execucao. Nada fica vermelho.

    ⚠️ NAO TEM CAMPO DE STATUS. Copia nasce BACKLOG, sempre.
    """

    title: str = Field(min_length=1, max_length=255)
    project_id: uuid.UUID | None = None
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    #: ⚠️ AUSENTE = HERDA O QUADRO DA ORIGEM, e nao "Quadro geral" -- diferente
    #: do `TaskCreateRequest`, onde `None` significa mesmo o geral.
    #:
    #: A diferenca e proposital: criar do zero nao tem de quem herdar,
    #: duplicar tem. E foi a ausencia deste campo que jogava a copia de um
    #: quadro avulso na lente do subtime (defeito de producao, 22/08).
    board_id: uuid.UUID | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)
    include_subtasks: bool = False
    # D13: so os responsaveis das SUBTAREFAS. Os do pai vem em assignee_ids.
    # Default True = comportamento da D6 original (a copia leva tudo igual).
    include_assignees: bool = True

    # ⚠️ PASSO 2 DO MODAL (ADR 0031). Chaves = ids de subtarefa DIRETA da
    # origem. Ausentes = comportamento antigo, entao cliente velho nao muda.
    #
    # `subtask_assignees` presente para uma filha = escolha explicita de quem
    # clicou: vai crua e um invalido DA 422, igual ao `assignee_ids` do pai.
    # Lista vazia e RECUSADA -- filha sem responsavel e o que a ADR 0031
    # fecha; para nao levar a subtarefa, use `skip_subtasks`.
    subtask_assignees: dict[uuid.UUID, list[uuid.UUID]] = Field(
        default_factory=dict
    )
    skip_subtasks: list[uuid.UUID] = Field(default_factory=list)


class TaskDuplicateResponse(TaskListItem):
    """A copia + os responsaveis de SUBTAREFA descartados (D9-c).

    `skipped_assignees` vazio e o caso normal. Nao vazio significa que alguma
    subtarefa nasceu sem responsavel porque o responsavel original nao alcanca
    mais a task -- a tela avisa, e a pessoa corrige. Devolver isso e o que
    impede a excecao de virar orfa invisivel.
    """

    skipped_assignees: list[uuid.UUID] = []
    # ⚠️ True = a copia virou tarefa de TOPO porque a irma que ela seria
    # nasceria dentro de um pai arquivado -- e o quadro so desenha raiz, entao
    # ela existiria sem nenhuma tela pra mostra-la. A tela AVISA; promover em
    # silencio mudaria a hierarquia pelas costas de quem clicou.
    promoted_to_root: bool = False


class TaskListResponse(BaseModel):
    """Pagina de tasks."""

    items: list[TaskListItem]
    total: int
    page: int
    size: int


# =========================================================
# COLLABORATION (Entrega 4)
# =========================================================
class AssigneeCreateRequest(BaseModel):
    """Designa um responsavel (assignee) para a task."""

    user_id: uuid.UUID


class WatcherCreateRequest(BaseModel):
    """Inscreve um observador (watcher).

    user_id ausente/None => o proprio usuario logado (self-watch).
    """

    user_id: uuid.UUID | None = None


class CollaboratorListResponse(BaseModel):
    """Lista de IDs (responsaveis OU observadores) de uma task."""

    task_id: uuid.UUID
    user_ids: list[uuid.UUID]


class TaskDetailResponse(TaskResponse):
    """GET /tasks/{id}: TaskResponse + colaboradores (apenas IDs).

    A listagem (GET /tasks) NAO inclui estes campos -- mantem a query
    enxuta e evita N+1 (decisao 9 da spec 004).
    """

    assignee_ids: list[uuid.UUID]
    watcher_ids: list[uuid.UUID]


# ------------------------------------------------------------
# /me/assignments (Entrega 6 -- ADR 0017/0018)
# ------------------------------------------------------------
class MeRelation(str, Enum):
    """Relacao do usuario logado com uma task."""

    assignee = "assignee"
    creator = "creator"
    watcher = "watcher"


class MyTaskItem(TaskResponse):
    """Item de /me/assignments: task + relacoes que tenho.

    `relations`: TODAS as relacoes que tenho com a task (independe do filtro).

    ⚠️ A FLAG DE ESCOPO DA ADR 0017 SAIU DAQUI NA SPEC 037 (E5), e a
    remocao MUDA O CONTRATO da API: o campo booleano deixa de existir na
    resposta. Cliente que o lia (o front de /minhas-tarefas, `lib/api.ts`,
    `lib/notificacoes.ts` e `tarefa/[id]`) foi ajustado na mesma fatia -- e
    esta e a unica fatia da Spec 037 que toca o front, por isso.

    ⚠️ NAO E SO O CAMPO QUE SUMIU: a task que a lente nao alcanca deixa de
    APARECER nesta lista (a camada (B) entrou em `list_my_relations`). Um
    cliente que so parasse de ler o campo continuaria correto; um que
    contasse itens vai ver numero menor.
    """

    relations: list[str]
    # Responsaveis (so IDs), em LOTE como o TaskListItem do quadro (ADR 0025).
    # Sem isto, a tela "Minhas tarefas" reaproveita o item e o detalhe mostra
    # "Ninguem designado" mesmo pra quem esta designado.
    assignee_ids: list[uuid.UUID] = []
    #: Titulo da tarefa-mae, quando esta e subtarefa. Tambem em LOTE.
    #:
    #: POR QUE existe: "Minhas tarefas" e a UNICA tela que mostra subtarefa
    #: como card solto -- o quadro geral so exibe raizes (ADR 0004) e a
    #: subtarefa aparece DENTRO do card da mae, onde o contexto e obvio.
    #: Solta, ela perdia a ancora: o selo dizia so "Subtarefa".
    #:
    #: `None` quando nao ha mae, ou quando a mae nao e visivel pela lente do
    #: usuario. O front cai no rotulo generico -- nunca inventa titulo.
    parent_title: str | None = None


class MyAssignmentsResponse(BaseModel):
    """Pagina de /me/assignments."""

    items: list[MyTaskItem]
    total: int
    page: int
    size: int


# =========================================================
# COMMENT (Entrega 14)
# =========================================================
class CommentCreateRequest(BaseModel):
    """Cria um comentario. content e validado de novo no dominio (strip,
    1..5000); o max_length aqui so barra payload absurdo cedo."""

    content: str = Field(min_length=1, max_length=5000)
    #: opcional -- responde um comentario de TOPO da mesma task (1 nivel, D4).
    parent_comment_id: uuid.UUID | None = None


class CommentUpdateRequest(BaseModel):
    """Edita o conteudo de um comentario (so o autor)."""

    content: str = Field(min_length=1, max_length=5000)


class CommentReactionSetRequest(BaseModel):
    """Poe ou troca a reacao de quem chama (Spec 050).

    ⚠️ "E exatamente um emoji?" NAO mora aqui, e sim no dominio
    (`normalize_emoji`), que devolve 422 pelo caminho do `ValidationError`.
    Validador do Pydantic que levanta devolve 500 (AGENTS.md §9). O
    `max_length` so barra payload absurdo cedo.
    """

    emoji: str = Field(min_length=1, max_length=64)


class CommentReactionResponse(BaseModel):
    """Uma pilula da fileira: o emoji e quem reagiu com ele (Spec 050, §4.4).

    ⚠️ `user_ids`, e nao a contagem: a tela mostra QUEM reagiu, e a contagem e
    o tamanho da lista.
    """

    model_config = {"from_attributes": True}

    emoji: str
    user_ids: list[uuid.UUID]


class CommentResponse(BaseModel):
    """Representacao de um comentario na API. Quando is_deleted, `content` ja
    vem mascarado (tombstone) -- ver D5."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    content: str
    edited_at: datetime | None
    created_at: datetime
    is_deleted: bool
    #: Spec 050: a fileira, na ordem de chegada. Vazia em comentario apagado.
    reactions: list[CommentReactionResponse]


class CommentListResponse(BaseModel):
    """Pagina do thread de comentarios de uma task (created_at ASC)."""

    items: list[CommentResponse]
    total: int
    page: int
    size: int


# =========================================================
# QUADRO (Spec 036 fatia 2)
# =========================================================
class BoardColumnResponse(BaseModel):
    """Uma coluna de quadro, como o front a recebe.

    ⚠️ `semantic` VAI JUNTO desde a primeira versao do contrato, e ele e o
    unico campo daqui que ainda nao tem leitor. A sondagem de 06/08 mediu que
    `web/lib/status.ts` reimplementa a semantica a mao, em tres conjuntos de
    status cravados (`STATUS_OCULTOS_POR_PADRAO`, `STATUS_QUE_PARAM`, e o
    `COMPLETED || CANCELLED || BLOCKED` dentro de `deadlineTone`) -- sem este
    campo, a fatia 4 nao teria como substitui-los e a fatia 3 teria de mudar o
    contrato de novo, com o front ja pendurado nele.

    ⚠️ `notify_deadline` pelo mesmo motivo: o backend ja o respeita
    (`DeadlineNotifyService`), e hoje o front cobra prazo de coluna que o
    backend sabe que nao deve cobrar. ⚠️ **RESPEITAR NAO E PODER ESCREVER:**
    desde 22/08 o lote muda esta flag -- ver `ColunaParaAvisar`. Expor agora
    custa uma linha; expor depois custa uma versao de endpoint.

    ⚠️ `legacy_status` NAO entra. Ele e ponte com data de demolicao (ADR 0033)
    e some quando o front passar a ler colunas do banco -- que e exatamente o
    que este endpoint existe para permitir. Expo-lo convidaria o front a se
    amarrar na ponte em vez de na semantica.

    ⚠️ `is_status_bridge` ENTROU EM 17/08, E NAO E O `legacy_status`
    DISFARCADO. Ele diz APENAS "esta coluna e ponte de algum status"; nao diz
    QUAL. O argumento da ADR 0033 continua de pe: com um booleano o front nao
    consegue mapear status -> coluna, que era o acoplamento a evitar.

    ⚠️ POR QUE ELE PRECISOU EXISTIR. A 6a-bis abriu a edicao do Quadro geral, e
    `_assert_ponte_sobrevive` recusa apagar coluna COM PONTE do quadro PADRAO.
    Sem este campo o front nao tem como saber onde o "x" vai falhar, e
    desenharia oito botoes de apagar condenados a derrubar o lote inteiro no
    "Concluir edicao" -- *lixeira que nao funciona e lixeira em que alguem
    clica*.

    ⚠️⚠️ **ELE SOZINHO NAO SIGNIFICA "NAO PODE SER APAGADA", E CONFUNDIR OS
    DOIS QUEBRA O QUADRO AVULSO.** As QUATRO colunas base de um quadro avulso
    tambem nascem com `legacy_status` (`board_defaults.py`), entao
    `is_status_bridge` e `True` nelas -- e elas PODEM ser apagadas. A trava e
    `quadro.is_default AND legacy_status is not None`, e a metade que falta
    (`is_default`) ja viaja no `BoardResponse`. **Quem combina os dois e o
    front, em UM lugar** (`impedimentoDeExclusao`).

    ⚠️ SEM `@model_validator` AQUI. A derivacao mora numa `@property` do
    `BoardColumn`, e `from_attributes` a le como se fosse coluna do banco --
    entao os SEIS lugares que constroem esta resposta com
    `model_validate(coluna)` continuam iguais, sem consulta nova em nenhum.
    Validador custom neste projeto ja devolveu 500 uma vez (ver
    `TaskUpdateRequest`); a `@property` nao tem esse caminho.
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    color: str
    position: int
    semantic: ColumnSemantic
    notify_deadline: bool
    is_default_target: bool
    is_status_bridge: bool


class BoardCreateRequest(BaseModel):
    """Corpo de `POST /boards` (Spec 036, fatia 5b).

    ⚠️ SEM `@model_validator`, E SEM `Field(min_length=...)`. Regra de request
    deste projeto NAO mora no Pydantic: o `_validation_error_handler` poe
    `exc.errors()` cru no envelope, e o `ctx` de um validador custom carrega o
    objeto `ValueError`, que o `json.dumps` do Starlette recusa -- sai **500,
    nao 422** (medido em 10/08, e o defeito do handler continua latente).
    Nome vazio e nome longo demais sao recusados no `BoardService._nome_valido`,
    com a `ValidationError` de dominio.

    ⚠️ `is_default` NAO ENTRA, e a ausencia e a trava. Quadro criado por pessoa
    e sempre nao-padrao; aceitar o campo aqui deixaria a API pedir um segundo
    quadro padrao no mesmo time, que o indice parcial `board_um_padrao_por_time`
    recusa NO BANCO -- 500 de constraint no lugar de uma regra.

    ⚠️ `colunas` NAO ENTRA. Quadro nasce com as quatro `COLUNAS_BASE`; montar
    colunas e o CRUD da fatia seguinte. Aceitar a lista aqui abriria criar
    quadro sem coluna `OPEN` ou sem `DONE`, que e exatamente o estado que a
    ADR 0042 D4 existe para impedir.
    """

    name: str
    team_id: uuid.UUID


class BoardRenameRequest(BaseModel):
    """Corpo de `PATCH /boards/{id}` (Spec 036, fatia 5b).

    ⚠️ SO O NOME. `team_id` fora de proposito: ele decide QUEM ENXERGA o quadro
    (ADR 0035 D3), entao troca-lo e operacao de visibilidade disfarcada de
    edicao -- as tarefas de dentro mudariam de publico sem pedido e sem
    historico. Ver `BoardService.renomear_quadro`.
    """

    name: str


class ColunaParaCriar(BaseModel):
    """Uma coluna a nascer dentro do lote (Spec 036, fatia 6a-ter).

    ⚠️ E O UNICO CORPO QUE CRIA COLUNA desde 17/09/2026. O `POST
    /boards/{id}/columns` e o schema dele (`BoardColumnCreateRequest`) sairam
    sem chamador; a nota longa que morava la -- por que `color` e
    `notify_deadline` so ganharam escritor pelo lote (Spec 039, F9) -- esta no
    historico do git e na docstring de `BoardService.criar_coluna`.

    ⚠️ `is_default_target` NAO ENTRA, e a ausencia e a trava: o indice parcial
    `board_column_um_destino_por_semantica` recusaria o segundo alvo NO BANCO
    (500). Trocar alvo e a lista `alvos` do lote. `legacy_status` NAO ENTRA,
    NUNCA: coluna criada por gente nao corresponde a status nenhum (ADR 0041).
    `position` NAO ENTRA: quem ordena e a lista `ordem` do lote.
    """

    #: ⚠️ APELIDO DO CLIENTE, e nao id. A coluna ainda nao existe quando a
    #: pessoa escolhe que as tarefas de outra vao para ela -- e esse caso e a
    #: RAZAO DE SER do lote (trocar uma coluna por outra num gesto so). O
    #: servico monta o mapa `tmp -> id real` na etapa de criacao e o usa nas
    #: etapas seguintes.
    tmp: str
    name: str
    semantic: ColumnSemantic
    #: Spec 039 (F9). ⚠️ `None` = a rotacao decide, que e o comportamento de
    #: sempre -- e por isso o default nao pode virar uma cor concreta: cliente
    #: velho que nao manda o campo tem de continuar recebendo a rotacao.
    #:
    #: ⚠️ SO TOKEN DA PALETA, e a recusa mora no `BoardService` (por LISTA, e
    #: nao por regex de hex). Aqui nao ha `Field(pattern=...)` pelo mesmo motivo
    #: de sempre neste projeto: validador do Pydantic devolve **500**, e nao
    #: 422, por causa do `_validation_error_handler`.
    color: str | None = None
    #: Spec 039 (F9) e §7.3 da spec. Default `True` = o comportamento de hoje.
    notify_deadline: bool = True


class ColunaParaAvisar(BaseModel):
    """Coluna que muda de opiniao sobre cobrar prazo (Spec 039, F9).

    ⚠️ ESTE E O CAMPO QUE PASSOU MESES SEM ESCRITOR (a nota longa morava no
    `BoardColumnCreateRequest`, removido em 17/09): ele era LIDO pelo `DeadlineNotifyService`
    e EXPOSTO na resposta, mas nenhuma rota o escrevia. Tres lugares do codigo
    prometiam por escrito que dava para criar "Aguardando cliente" sem cobrar
    prazo; nao dava. A partir daqui da.

    ⚠️ SO COLUNA QUE JA EXISTE -- coluna nova ja nasce com o valor certo pelo
    `ColunaParaCriar`. Mesma ausencia de `tmp:` do `ColunaParaRenomear`, e pelo
    mesmo motivo: duas fontes sobre a mesma linha fariam a ordem das etapas
    virar regra invisivel.
    """

    id: uuid.UUID
    notify_deadline: bool


class ColunaParaRenomear(BaseModel):
    """⚠️ SO COLUNA QUE JA EXISTE. Coluna criada no mesmo lote ja nasce com o
    nome final -- renomea-la aqui seria dizer duas coisas sobre a mesma linha,
    e a ordem entre as duas viraria regra invisivel."""

    id: uuid.UUID
    name: str


class ColunaParaApagar(BaseModel):
    """Uma coluna a sumir, e para onde vao as tarefas dela."""

    id: uuid.UUID
    #: ⚠️ ACEITA `tmp:apelido` ALEM DE UUID, e e por isso que e `str`. Sem isso
    #: nao da para apagar "Aprovacao" mandando as tarefas para a "Entregue" que
    #: voce acabou de criar -- que e o caso de uso que trouxe o lote.
    #:
    #: ⚠️ `None` E "A COLUNA ESTA VAZIA", e nao "tanto faz". O servico recusa
    #: com `coluna_sem_destino` se houver tarefa viva OU APAGADA.
    destino: str | None = None


class BoardColumnsBatchRequest(BaseModel):
    """Corpo de `PUT /boards/{id}/columns` (Spec 036, fatia 6a-ter).

    O estado DESEJADO das colunas, num pedido so, numa transacao so.

    ⚠️ `PUT` E NAO `PATCH`: o corpo descreve o conjunto final, e nao um remendo.

    ⚠️ A ORDEM DAS ETAPAS E DO SERVICO, E NAO DESTE SCHEMA: criar, renomear,
    apagar, reordenar. Criar antes porque a coluna nova pode ser destino de uma
    apagada; reordenar por ultimo porque a conferencia de conjunto dele compara
    com as colunas que existem DEPOIS de criar e apagar.

    ⚠️ `ordem` VAZIA E "NAO MEXER NA ORDEM", e nao "deixar sem ordem". A pessoa
    que so renomeou uma coluna nao deveria ser obrigada a mandar a lista
    inteira -- e mandar lista vazia seria um conjunto diferente do quadro, que
    o reordenar recusaria com `colunas_divergentes`. Um pedido legitimo viraria
    erro.
    """

    criar: list[ColunaParaCriar] = Field(default_factory=list)
    renomear: list[ColunaParaRenomear] = Field(default_factory=list)
    #: Spec 039 (F9). Colunas que ligam ou desligam a cobranca de prazo.
    #:
    #: ⚠️ RODA ENTRE `renomear` E `alvos`, e a ordem tem motivo: uma coluna
    #: apagada no mesmo lote some na etapa 4, e mexer na flag dela depois seria
    #: 404 por uma coluna que a propria pessoa mandou apagar.
    avisos: list[ColunaParaAvisar] = Field(default_factory=list)
    #: Colunas que passam a ser o ALVO da semantica delas (Spec 036, fatia 12).
    #:
    #: ⚠️ SO UUID -- `tmp:` NAO E ACEITO AQUI, e a ausencia e a regra. Coluna
    #: nova nao tem id no momento em que a pessoa monta o lote, e amarrar o
    #: alvo a uma coluna que nasce no mesmo pedido faria a ORDEM DAS ETAPAS
    #: virar regra invisivel. A pessoa cria, conclui, e marca depois.
    #:
    #: ⚠️ A ETAPA RODA ANTES DE APAGAR, e isso e o que permite "trocar o alvo e
    #: apagar a coluna antiga" num gesto so -- ver `BoardService.aplicar_lote`.
    alvos: list[uuid.UUID] = Field(default_factory=list)
    apagar: list[ColunaParaApagar] = Field(default_factory=list)
    #: UUID em texto, ou `tmp:apelido`.
    ordem: list[str] = Field(default_factory=list)


class BoardColumnsBatchResponse(BaseModel):
    """O quadro depois do lote.

    ⚠️ DEVOLVE AS COLUNAS INTEIRAS, e nao 204. A tela passou a edicao toda sem
    falar com o servidor; ela precisa do estado real de volta -- inclusive dos
    ids das colunas que acabaram de nascer, que ate agora ela so conhecia pelo
    apelido `tmp`.
    """

    colunas: list[BoardColumnResponse]
    #: ⚠️ SOMA DE TODAS AS EXCLUSOES do lote. Se vier diferente do que a tela
    #: mostrou na revisao, alguem mexeu no meio -- e a tela pode dizer isso.
    movidas: int


class BoardColumnDetailResponse(BoardColumnResponse):
    """Uma coluna com a contagem de tarefas (Spec 036, fatia 5b-4b).

    ⚠️ EXISTE PARA O AVISO DE APAGAR, e so. A tela precisa dizer "12 tarefas
    vao para..." ANTES de a pessoa confirmar, e a listagem de quadros nao
    carrega contagem -- poria um `COUNT` por coluna em toda abertura de tela
    para um numero que quase ninguem le.

    ⚠️ `task_count` NAO CONTA APAGADAS e CONTA ARQUIVADAS. Ver
    `BoardService.contar_tarefas_da_coluna`: e o numero que a PESSOA ve, e
    tarefa apagada nao existe para ela. Apagar a coluna (etapa `apagar` do lote)
    move as apagadas junto por causa da FK `RESTRICT`, entao os dois numeros
    divergem de proposito.

    ⚠️ ELE ENVELHECE. Alguem pode mover uma tarefa para ca entre este `GET` e o
    lote. A divergencia possivel e entre o AVISO e o resultado, nunca entre
    o resultado e o banco.
    """

    task_count: int


class BoardResponse(BaseModel):
    """Um quadro alcancavel, com as colunas na ordem visual.

    ⚠️ `workspace_id` NAO entra. Todo quadro devolvido e do workspace de quem
    perguntou -- a consulta garante -- e devolver o campo convidaria o front a
    filtrar por ele, o que seria fazer no cliente uma trava que so vale no
    servidor.

    ⚠️ `deleted_at` NAO entra: quadro apagado nao e devolvido, entao o campo
    so poderia valer `null`. Campo que so tem um valor possivel e campo que
    alguem vai testar um dia e concluir a coisa errada.
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    team_id: uuid.UUID
    is_default: bool
    colunas: list[BoardColumnResponse]


class BoardDetailResponse(BoardResponse):
    """`GET /boards/{id}` -- o quadro mais a contagem de tarefas VIVAS.

    ⚠️ EXISTE PARA A CONFIRMACAO DE APAGAR (fatia 7). A tela precisa dizer
    "isto vai apagar N tarefas" ANTES do clique. `GET /boards` nao traz
    contagem de proposito -- ela custaria uma subconsulta por quadro num
    endpoint que roda a cada abertura de tela.

    ⚠️ MESMO DESENHO DE `BoardColumnDetailResponse`, que ja faz isto para a
    coluna: herda a resposta e acrescenta `task_count`. Duas formas diferentes
    para a mesma ideia obrigariam o front a lembrar qual e qual.

    ⚠️ CONTA AS ARQUIVADAS JUNTO, porque elas somem no `DELETE`. Um numero que
    as ignorasse mentiria para MENOS na confirmacao de algo irreversivel.
    """

    task_count: int


class BoardDeleteResponse(BaseModel):
    """`DELETE /boards/{id}` -- quantas tarefas foram apagadas junto.

    ⚠️ O NUMERO E PARA COMPARAR COM O DA CONFIRMACAO, e nao enfeite. Entre ler
    a contagem e clicar, alguem pode ter criado tarefa naquele quadro; se os
    dois discordarem, a tela avisa. Mesmo desenho do `movidas` do lote de
    colunas e da `mensagemDeDivergencia`.
    """

    tarefas_apagadas: int
