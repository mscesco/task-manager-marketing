"""Schemas (DTOs) de request/response do modulo tasks.

Contem schemas de Project (Entrega 1) e Task (Entrega 2).

NOTAS de design:
    - is_personal e created_by NAO aparecem em Create/Update --
      pessoal nao eh criado via /projects (so via fluxos internos)
      e ambos os campos sao imutaveis.
    - Validacao cruzada (start_date <= due_date) vive no service,
      sobre o estado RESULTANTE do PATCH.
    - Em Task, project_id e parent_task_id NAO entram em
      TaskUpdateRequest -- usar /tasks/{id}/move.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.db.models.enums import (
    ColumnSemantic,
    PriorityLevel,
    ProjectStatus,
    TaskStatus,
)

# Limite defensivo para description -- generoso, mas evita uploads
# acidentais de Mb de texto.
_DESCRIPTION_MAX = 100_000


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
    is_personal: bool
    team_id: uuid.UUID | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ProjectCreateRequest(BaseModel):
    """Criacao de projeto COMUM. workspace_id, created_by e is_personal
    sao internos -- nunca vem do cliente."""

    title: str = Field(min_length=1, max_length=255)
    team_id: uuid.UUID  # Entrega 3: time dono (obrigatorio em comum).
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


class ProjectUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    is_personal e created_by ausentes por design -- imutaveis.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


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
    """Representacao de uma task na API."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    parent_task_id: uuid.UUID | None
    team_id: uuid.UUID | None
    title: str
    description: str
    status: TaskStatus
    priority: PriorityLevel
    position: int
    depth: int
    path: str
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    is_archived: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


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
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None
    # Spec 021: 0+ responsaveis ja na criacao. Vazio = sem responsavel
    # (comportamento anterior). Validacao (alcance/ativo/monouser) e atomica
    # no service: qualquer invalido -> 422 listando todos, nada criado.
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)


class TaskUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    project_id e parent_task_id NAO entram aqui -- usar
    POST /tasks/{id}/move.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


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
    """

    assignee_ids: list[uuid.UUID] = []


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
    backend sabe que nao deve cobrar. Expor agora custa uma linha; expor depois
    custa uma versao de endpoint.

    ⚠️ `legacy_status` NAO entra. Ele e ponte com data de demolicao (ADR 0033)
    e some quando o front passar a ler colunas do banco -- que e exatamente o
    que este endpoint existe para permitir. Expo-lo convidaria o front a se
    amarrar na ponte em vez de na semantica.
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    color: str
    position: int
    semantic: ColumnSemantic
    notify_deadline: bool
    is_default_target: bool


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
