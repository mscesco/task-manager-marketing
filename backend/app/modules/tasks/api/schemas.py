"""Schemas (DTOs) de request/response do modulo tasks.

Validacao cruzada (start_date <= due_date) vive no service, sobre o estado
resultante do PATCH. Regra de request nao mora em validador do Pydantic: o
`_validation_error_handler` devolveria 500 em vez de 422.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from enum import Enum

from pydantic import BaseModel, Field, computed_field

from app.core.tenant import can_in, current_tenant
from app.db.models.enums import (
    ColumnSemantic,
    PriorityLevel,
    ProjectStatus,
    TaskStatus,
)
from app.modules.auth.domain import team_scope

# Limite defensivo: evita colar megabytes de texto por acidente.
_DESCRIPTION_MAX = 100_000


# =========================================================
# PROJECT
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

    # Permissao no time do projeto, nao o papel global do `/auth/me`.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_update(self) -> bool:
        return can_in("project.update", self.team_id)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return can_in("project.delete", self.team_id)


class ProjectCreateRequest(BaseModel):
    """Criacao de projeto. workspace_id e created_by sao internos."""

    title: str = Field(min_length=1, max_length=255)
    team_id: uuid.UUID
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    status: ProjectStatus = ProjectStatus.PLANNING
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None


class ProjectUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer."""

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: ProjectStatus | None = None
    priority: PriorityLevel | None = None
    start_date: date | None = None
    due_date: date | None = None


class LinkIn(BaseModel):
    """Um link a gravar. A regra de verdade mora em `link_service.validar_links`;
    os limites daqui so barram payload inflado."""

    title: str = Field(max_length=500)
    url: str = Field(max_length=4096)


class LinksReplaceRequest(BaseModel):
    """A lista inteira de links do item, na ordem -- substitui a atual."""

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
# TASK
# =========================================================
class TaskResponse(BaseModel):
    """Representacao de uma task na API.

    Dados da coluna e nome do quadro nao vem aqui: o front cruza `board_id` e
    `column_id` com o `GET /boards`.
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
    # `None` = vence no dia. Hora sem data e recusada pelo service (422).
    due_time: time | None
    completed_at: datetime | None
    is_archived: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    # Excluir a tarefa e moderar comentario alheio nela.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_delete(self) -> bool:
        return can_in("task.delete", self.team_id)

    # Por e tirar seguidor alheio; mesma regra de
    # `CollaborationService._assert_can_manage_others`.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_manage_watchers(self) -> bool:
        tenant = current_tenant()
        if tenant is None or not can_in("task.assign", self.team_id):
            return False
        editaveis = team_scope.editable_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )
        return editaveis is None or (
            self.team_id is not None and self.team_id in editaveis
        )


class DeleteTaskResponse(TaskResponse):
    """Resposta do DELETE -- inclui contagem de filhas apagadas."""

    cascade_count: int


class ArchiveTaskResponse(TaskResponse):
    """Resposta de archive/unarchive; a contagem da cascata e para a tela avisar."""

    cascade_count: int


class TaskCreateRequest(BaseModel):
    """Criacao de task. workspace_id, created_by, path e depth sao internos."""

    title: str = Field(min_length=1, max_length=255)
    project_id: uuid.UUID | None = None
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    # `None` = Quadro geral. Ignorado em subtarefa (herda o quadro do pai).
    # O alcance e conferido em `TaskService._assert_board_in_reach`.
    board_id: uuid.UUID | None = None
    status: TaskStatus = TaskStatus.BACKLOG
    priority: PriorityLevel = PriorityLevel.MEDIUM
    start_date: date | None = None
    due_date: date | None = None
    # `None` = vence no dia. Hora sem data e recusada pelo service (422).
    due_time: time | None = None
    # Validacao atomica no service: qualquer invalido -> 422, nada criado.
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)
    # Mesma forma do `assignee_ids`. Precisa ser repassado no router, senao some.
    watcher_ids: list[uuid.UUID] = Field(default_factory=list)


class TaskUpdateRequest(BaseModel):
    """Atualizacao parcial (PATCH). Campo ausente = nao mexer.

    project_id e parent_task_id nao entram -- usar POST /tasks/{id}/move.
    `status` e `column_id` sao mutuamente exclusivos (regra conferida no router).
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=_DESCRIPTION_MAX)
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    team_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    # `None` = vence no dia. Hora sem data e recusada pelo service (422).
    due_time: time | None = None
    # Tem de ser do quadro da tarefa (conferido no service); o status e derivado dela.
    column_id: uuid.UUID | None = None


class TaskMoveRequest(BaseModel):
    """Move pra novo pai e/ou projeto. No-op silencioso se nada muda.

    `detach_project=True` tira a task de projeto; nao combina com
    project_id/parent_task_id e so vale em task de topo.
    """

    parent_task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    detach_project: bool = False


class TaskRelocateRequest(BaseModel):
    """Mover para outro quadro e/ou outra mae, com a subarvore.

    Com `parent_task_id`, quadro e time vem da mae. Sem ele, a tarefa vira
    principal no `board_id`; `team_id` so escolhe a lente de subtime no
    Quadro geral. `dry_run=true` devolve a previa sem gravar.
    """

    board_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    dry_run: bool = False


class PessoaQueSaiResponse(BaseModel):
    user_id: uuid.UUID
    nome: str
    tarefas: int


class StatusQueMudaResponse(BaseModel):
    de: TaskStatus
    para: TaskStatus
    tarefas: int


class TaskRelocateResponse(BaseModel):
    """`task` vem `null` na previa (`dry_run`)."""

    task: TaskResponse | None
    mudou: bool
    subtarefas: int
    projeto_antes: str | None
    projeto_depois: str | None
    saem: list[PessoaQueSaiResponse]
    assume: int
    status_muda: list[StatusQueMudaResponse] = []


class TaskSearchHitResponse(BaseModel):
    """Um resultado da busca do mover. `caminho` = titulos das ancestrais, da
    raiz para baixo (vazio para tarefa principal)."""

    id: uuid.UUID
    title: str
    team_id: uuid.UUID | None
    depth: int
    caminho: list[str]


class TaskListItem(TaskResponse):
    """Item da listagem do quadro: TaskResponse + dados agregados em lote.

    Os campos extras sao preenchidos no router com uma query por pagina, para
    o quadro nao precisar carregar as subtarefas.
    """

    assignee_ids: list[uuid.UUID] = []

    #: Filhas diretas nao arquivadas.
    subtask_total: int = 0

    #: Filhas diretas em coluna `DONE` (regra em `domain/subtask_progress.py`).
    subtask_done: int = 0

    #: Responsaveis da subarvore inteira, raiz incluida (filtro por pessoa).
    subtree_assignee_ids: list[uuid.UUID] = []


class TaskDuplicateRequest(BaseModel):
    """Duplicacao. Sem data nem status de proposito: a copia nasce BACKLOG e
    sem prazo, para nao disparar aviso de atraso em lote."""

    title: str = Field(min_length=1, max_length=255)
    project_id: uuid.UUID | None = None
    description: str = Field(default="", max_length=_DESCRIPTION_MAX)
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    #: Ausente = herda o quadro da origem (diferente do `TaskCreateRequest`).
    board_id: uuid.UUID | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)
    include_subtasks: bool = False
    # So os responsaveis das subtarefas; os do pai vem em assignee_ids.
    include_assignees: bool = True

    # Chaves = ids de subtarefa direta da origem. Lista vazia e recusada;
    # para nao levar a subtarefa, use `skip_subtasks`.
    subtask_assignees: dict[uuid.UUID, list[uuid.UUID]] = Field(
        default_factory=dict
    )
    skip_subtasks: list[uuid.UUID] = Field(default_factory=list)


class TaskDuplicateResponse(TaskListItem):
    """A copia + os responsaveis de subtarefa descartados por falta de alcance."""

    skipped_assignees: list[uuid.UUID] = []
    # True = a copia virou tarefa de topo porque o pai esta arquivado; a tela avisa.
    promoted_to_root: bool = False


class TaskListResponse(BaseModel):
    """Pagina de tasks."""

    items: list[TaskListItem]
    total: int
    page: int
    size: int


# =========================================================
# COLLABORATION
# =========================================================
class AssigneeCreateRequest(BaseModel):
    """Designa um responsavel (assignee) para a task."""

    user_id: uuid.UUID


class WatcherCreateRequest(BaseModel):
    """Inscreve um observador. user_id ausente => o proprio usuario logado."""

    user_id: uuid.UUID | None = None


class CollaboratorListResponse(BaseModel):
    """Lista de IDs (responsaveis OU observadores) de uma task."""

    task_id: uuid.UUID
    user_ids: list[uuid.UUID]


class TaskDetailResponse(TaskResponse):
    """GET /tasks/{id}: TaskResponse + colaboradores (apenas IDs)."""

    assignee_ids: list[uuid.UUID]
    watcher_ids: list[uuid.UUID]


# ------------------------------------------------------------
# /me/assignments
# ------------------------------------------------------------
class MeRelation(str, Enum):
    """Relacao do usuario logado com uma task."""

    assignee = "assignee"
    creator = "creator"
    watcher = "watcher"


class MyTaskItem(TaskResponse):
    """Item de /me/assignments: task + todas as relacoes que tenho com ela."""

    relations: list[str]
    assignee_ids: list[uuid.UUID] = []
    #: Titulo da tarefa-mae, quando e subtarefa. `None` sem mae ou mae fora da lente.
    parent_title: str | None = None


class MyAssignmentsResponse(BaseModel):
    """Pagina de /me/assignments."""

    items: list[MyTaskItem]
    total: int
    page: int
    size: int


# =========================================================
# COMMENT
# =========================================================
class CommentCreateRequest(BaseModel):
    """Cria um comentario. content e validado de novo no dominio (strip,
    1..5000); o max_length aqui so barra payload absurdo cedo."""

    content: str = Field(min_length=1, max_length=5000)
    #: opcional -- responde um comentario de topo da mesma task (1 nivel).
    parent_comment_id: uuid.UUID | None = None


class CommentUpdateRequest(BaseModel):
    """Edita o conteudo de um comentario (so o autor)."""

    content: str = Field(min_length=1, max_length=5000)


class CommentReactionSetRequest(BaseModel):
    """Poe ou troca a reacao de quem chama. "E um emoji so?" e conferido no
    dominio (`normalize_emoji`)."""

    emoji: str = Field(min_length=1, max_length=64)


class CommentReactionResponse(BaseModel):
    """Um emoji e quem reagiu com ele."""

    model_config = {"from_attributes": True}

    emoji: str
    user_ids: list[uuid.UUID]


class CommentResponse(BaseModel):
    """Representacao de um comentario. Quando is_deleted, `content` ja vem
    mascarado."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    content: str
    edited_at: datetime | None
    created_at: datetime
    is_deleted: bool
    #: Na ordem de chegada. Vazia em comentario apagado.
    reactions: list[CommentReactionResponse]


class HistoryEventResponse(BaseModel):
    """Um evento do historico da tarefa, cru: quem vira frase e o front."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    event_type: str
    field_name: str | None
    old_value: dict | None
    new_value: dict | None
    event_metadata: dict | None
    user_id: uuid.UUID
    created_at: datetime


class HistoryListResponse(BaseModel):
    """Historico paginado, mais novo primeiro."""

    items: list[HistoryEventResponse]
    total: int
    page: int
    size: int


class CommentListResponse(BaseModel):
    """Pagina do thread de comentarios de uma task (created_at ASC)."""

    items: list[CommentResponse]
    total: int
    page: int
    size: int


# =========================================================
# QUADRO
# =========================================================
class BoardColumnResponse(BaseModel):
    """Uma coluna de quadro, como o front a recebe.

    `is_status_bridge` sozinho nao significa "nao pode apagar": a trava e
    `quadro.is_default AND is_status_bridge`, combinada no front.
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
    """Corpo de `POST /boards`. Nome e validado em `BoardService._nome_valido`.
    O quadro nasce nao-padrao e com as colunas base."""

    name: str
    team_id: uuid.UUID


class BoardRenameRequest(BaseModel):
    """Corpo de `PATCH /boards/{id}`. So o nome: trocar `team_id` mudaria quem
    enxerga o quadro."""

    name: str


class ColunaParaCriar(BaseModel):
    """Uma coluna a nascer dentro do lote."""

    #: Apelido do cliente: a coluna ainda nao tem id e pode ser destino de outra.
    tmp: str
    name: str
    semantic: ColumnSemantic
    #: `None` = cor por rotacao. So token da paleta (conferido no `BoardService`).
    color: str | None = None
    notify_deadline: bool = True


class ColunaParaAvisar(BaseModel):
    """Coluna existente que liga ou desliga a cobranca de prazo."""

    id: uuid.UUID
    notify_deadline: bool


class ColunaParaRenomear(BaseModel):
    """So coluna que ja existe; coluna criada no lote ja nasce com o nome final."""

    id: uuid.UUID
    name: str


class ColunaParaApagar(BaseModel):
    """Uma coluna a sumir, e para onde vao as tarefas dela."""

    id: uuid.UUID
    #: UUID ou `tmp:apelido`. `None` = coluna vazia; recusado se houver tarefa.
    destino: str | None = None


class BoardColumnsBatchRequest(BaseModel):
    """Corpo de `PUT /boards/{id}/columns`: o estado desejado das colunas, numa
    transacao so. A ordem das etapas e do servico (`BoardService.aplicar_lote`).
    """

    criar: list[ColunaParaCriar] = Field(default_factory=list)
    renomear: list[ColunaParaRenomear] = Field(default_factory=list)
    avisos: list[ColunaParaAvisar] = Field(default_factory=list)
    #: Colunas que passam a ser o alvo da semantica delas. So UUID, sem `tmp:`.
    alvos: list[uuid.UUID] = Field(default_factory=list)
    apagar: list[ColunaParaApagar] = Field(default_factory=list)
    #: UUID em texto, ou `tmp:apelido`. Vazia = nao mexer na ordem.
    ordem: list[str] = Field(default_factory=list)


class BoardColumnsBatchResponse(BaseModel):
    """O quadro depois do lote, com os ids reais das colunas criadas."""

    colunas: list[BoardColumnResponse]
    #: Soma das tarefas movidas; a tela compara com o que mostrou na revisao.
    movidas: int


class BoardColumnDetailResponse(BoardColumnResponse):
    """Uma coluna com a contagem de tarefas, para o aviso de apagar.

    `task_count` nao conta apagadas e conta arquivadas.
    """

    task_count: int


class BoardResponse(BaseModel):
    """Um quadro alcancavel, com as colunas na ordem visual."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    team_id: uuid.UUID
    is_default: bool
    colunas: list[BoardColumnResponse]


class BoardDetailResponse(BoardResponse):
    """`GET /boards/{id}` -- o quadro mais a contagem de tarefas (arquivadas
    incluidas), para a confirmacao de apagar."""

    task_count: int


class BoardDeleteResponse(BaseModel):
    """`DELETE /boards/{id}` -- quantas tarefas foram apagadas junto; a tela
    compara com o numero da confirmacao."""

    tarefas_apagadas: int
