"""Router de Tasks. Regra de negocio mora no TaskService."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import SessionDep, UoWDep
from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.tasks.api.schemas import (
    ArchiveTaskResponse,
    DeleteTaskResponse,
    TaskCreateRequest,
    TaskDetailResponse,
    TaskDuplicateRequest,
    TaskDuplicateResponse,
    TaskListItem,
    TaskListResponse,
    TaskMoveRequest,
    TaskRelocateRequest,
    TaskRelocateResponse,
    TaskResponse,
    TaskUpdateRequest,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_notices import AvisosDaTarefa
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    MoveTaskCommand,
    RelocateCommand,
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import ValidationError
from app.shared.pagination import PageParams

router = APIRouter(prefix="/tasks", tags=["tasks"])


# --------------------------------------------------------
# Leitura
# --------------------------------------------------------
@router.get("", response_model=TaskListResponse)
async def list_tasks(
    _: TenantContextDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    project_id: uuid.UUID | None = None,
    parent_task_id: uuid.UUID | None = None,
    root_only: bool = False,
    task_status: TaskStatus | None = Query(None, alias="status"),
    priority: PriorityLevel | None = None,
    team_id: uuid.UUID | None = None,
    under_team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta pelas tarefas deste time e dos descendentes dele, pelo "
            "time EFETIVO (o do projeto, ou o da propria tarefa se avulsa). "
            "NAO confundir com `team_id`, que casa o time da tarefa por "
            "igualdade."
        ),
    ),
    created_by: uuid.UUID | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    q: str | None = Query(None, max_length=255),
) -> TaskListResponse:
    """Lista tasks do workspace, paginado, com filtros.

    `q` busca por titulo (sem acento e sem caixa) e casa tambem descendentes,
    devolvendo a raiz da subarvore. Nao implica `root_only`: o quadro combina
    os dois, e a listagem de filhas usa `parent_task_id` + `q`.
    """
    page_result = await TaskService(session).list_page(
        params=PageParams(page=page, size=size),
        filters=TaskFilters(
            project_id=project_id,
            parent_task_id=parent_task_id,
            root_only=root_only,
            status=task_status,
            priority=priority,
            team_id=team_id,
            under_team_id=under_team_id,
            created_by=created_by,
            include_archived=include_archived,
            archived_only=archived_only,
            q=q,
        ),
    )
    # Responsaveis, progresso e responsaveis da subarvore em lote, por pagina.
    amap = await CollaborationService(session).assignee_ids_for_tasks(
        page_result.items
    )
    ids_da_pagina = [t.id for t in page_result.items]
    repo = TaskRepository(session)
    progressos = await repo.subtask_progress_for_tasks(ids_da_pagina)
    subresp = await repo.subtree_assignee_ids_for_tasks(
        ids_da_pagina, include_archived=include_archived
    )
    return TaskListResponse(
        items=[
            TaskListItem.model_validate(t).model_copy(
                update={
                    "assignee_ids": amap.get(t.id, []),
                    "subtask_total": progressos[t.id].total,
                    "subtask_done": progressos[t.id].concluidas,
                    "subtree_assignee_ids": subresp.get(t.id, []),
                }
            )
            for t in page_result.items
        ],
        total=page_result.total,
        page=page_result.page,
        size=page_result.size,
    )


@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> TaskDetailResponse:
    """Obtem task pelo id, com assignee_ids / watcher_ids (so IDs)."""
    task = await TaskService(session).get(task_id)
    collab = CollaborationService(session)
    data = TaskResponse.model_validate(task).model_dump()
    return TaskDetailResponse(
        **data,
        assignee_ids=await collab.assignee_ids_for(task),
        watcher_ids=await collab.watcher_ids_for(task),
    )


# --------------------------------------------------------
# Escrita
# --------------------------------------------------------
@router.post(
    "",
    response_model=TaskListItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("task.create"))],
)
async def create_task(
    payload: TaskCreateRequest, uow: UoWDep
) -> TaskListItem:
    """Cria task. Exige task.create.

    Responde TaskListItem (com `assignee_ids`), para o card ja nascer com os
    responsaveis; as demais mutacoes respondem TaskResponse.
    """
    task = await TaskService(uow.session).create(
        CreateTaskCommand(
            project_id=payload.project_id,
            title=payload.title,
            description=payload.description,
            parent_task_id=payload.parent_task_id,
            team_id=payload.team_id,
            # Todo campo do payload precisa ser repassado: o command tem default
            # e um campo esquecido e descartado em silencio.
            board_id=payload.board_id,
            status=payload.status,
            priority=payload.priority,
            start_date=payload.start_date,
            due_date=payload.due_date,
            due_time=payload.due_time,
            assignee_ids=payload.assignee_ids,
            watcher_ids=payload.watcher_ids,
        )
    )
    # Le do banco o que foi gravado, na mesma transacao, em vez de ecoar o payload.
    assignee_ids = await CollaborationService(uow.session).assignee_ids_for(task)
    await uow.commit()
    return TaskListItem.model_validate(task).model_copy(
        update={"assignee_ids": assignee_ids}
    )


@router.post(
    "/{task_id}/duplicate",
    response_model=TaskDuplicateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("task.create"))],
)
async def duplicate_task(
    task_id: uuid.UUID, payload: TaskDuplicateRequest, uow: UoWDep
) -> TaskDuplicateResponse:
    """Duplica a task `task_id`.

    Usa a permissao de criar; a visibilidade da origem e conferida no service
    (origem invisivel -> 404).
    """
    resultado = await TaskService(uow.session).duplicate(
        DuplicateTaskCommand(
            source_id=task_id,
            title=payload.title,
            description=payload.description,
            project_id=payload.project_id,
            parent_task_id=payload.parent_task_id,
            team_id=payload.team_id,
            # Campo a campo: o que nao for repassado e descartado em silencio.
            board_id=payload.board_id,
            priority=payload.priority,
            assignee_ids=payload.assignee_ids,
            include_subtasks=payload.include_subtasks,
            include_assignees=payload.include_assignees,
            subtask_assignees=payload.subtask_assignees,
            skip_subtasks=payload.skip_subtasks,
        )
    )
    # Le do banco, na mesma transacao, como no POST comum.
    assignee_ids = await CollaborationService(uow.session).assignee_ids_for(
        resultado.task
    )
    await uow.commit()
    return TaskDuplicateResponse.model_validate(resultado.task).model_copy(
        update={
            "assignee_ids": assignee_ids,
            "skipped_assignees": resultado.skipped_assignees,
            "promoted_to_root": resultado.promoted_to_root,
        }
    )


@router.patch(
    "/{task_id}",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def update_task(
    task_id: uuid.UUID, payload: TaskUpdateRequest, uow: UoWDep
) -> TaskResponse:
    """Patch parcial. project_id e parent_task_id nao entram (usar move).

    Aceita `status` OU `column_id`; com `column_id`, o status e derivado da coluna.
    """
    # Recusa em vez de precedencia, olhando `model_fields_set` (null explicito
    # tambem conta). Fica aqui porque validador do Pydantic devolveria 500.
    veio = payload.model_fields_set
    if "status" in veio and "column_id" in veio:
        raise ValidationError(
            "Mande `status` OU `column_id`, nunca os dois: os dois escrevem "
            "a mesma dupla (status, coluna).",
            details={"field": "column_id"},
        )

    # Os avisos saem daqui, e nao do servico: o `update` tambem roda ao apagar coluna.
    avisos = AvisosDaTarefa(uow.session)
    antes = await avisos.retrato(task_id)
    task = await TaskService(uow.session).update(
        task_id=task_id,
        command=UpdateTaskCommand(
            title=payload.title,
            description=payload.description,
            status=payload.status,
            priority=payload.priority,
            team_id=payload.team_id,
            start_date=payload.start_date,
            due_date=payload.due_date,
            due_time=payload.due_time,
            column_id=payload.column_id,
            # Distingue null explicito (limpar) de campo ausente (nao mexer).
            fields_set=frozenset(payload.model_fields_set),
        ),
    )
    await avisos.depois_da_edicao(antes, task)
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/move",
    response_model=TaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def move_task(
    task_id: uuid.UUID, payload: TaskMoveRequest, uow: UoWDep
) -> TaskResponse:
    """Move pra novo pai e/ou projeto. No-op silencioso se nada muda."""
    task = await TaskService(uow.session).move(
        task_id=task_id,
        command=MoveTaskCommand(
            parent_task_id=payload.parent_task_id,
            project_id=payload.project_id,
            detach_project=payload.detach_project,
        ),
    )
    await uow.commit()
    return TaskResponse.model_validate(task)


@router.post(
    "/{task_id}/relocate",
    response_model=TaskRelocateResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def relocate_task(
    task_id: uuid.UUID, payload: TaskRelocateRequest, uow: UoWDep
) -> TaskRelocateResponse:
    """Move para outro quadro e/ou outra mae, levando a subarvore.

    A rota confere o verbo de editar a origem; criar no destino e conferido no
    servico.
    """
    resultado = await TaskService(uow.session).relocate(
        task_id=task_id,
        command=RelocateCommand(
            board_id=payload.board_id,
            team_id=payload.team_id,
            parent_task_id=payload.parent_task_id,
        ),
        dry_run=payload.dry_run,
    )
    if not payload.dry_run:
        await uow.commit()
    return TaskRelocateResponse(
        task=(
            TaskResponse.model_validate(resultado.task)
            if resultado.task is not None
            else None
        ),
        mudou=resultado.mudou,
        subtarefas=resultado.subtarefas,
        projeto_antes=resultado.projeto_antes,
        projeto_depois=resultado.projeto_depois,
        saem=[
            {"user_id": p.user_id, "nome": p.nome, "tarefas": p.tarefas}
            for p in resultado.saem
        ],
        assume=resultado.assume,
        status_muda=[
            {"de": de, "para": para, "tarefas": n}
            for de, para, n in resultado.status_muda
        ],
    )


@router.post(
    "/{task_id}/archive",
    response_model=ArchiveTaskResponse,
    dependencies=[Depends(require_permission("task.archive"))],
)
async def archive_task(task_id: uuid.UUID, uow: UoWDep) -> ArchiveTaskResponse:
    """Arquiva a task e a subarvore. Idempotente.

    `cascade_count` = subtarefas arquivadas junto (nao conta a propria).
    """
    avisos = AvisosDaTarefa(uow.session)
    antes = await avisos.retrato(task_id)
    resultado = await TaskService(uow.session).archive(task_id=task_id)
    await avisos.depois_de_arquivar(antes, resultado.task)
    await uow.commit()
    task_data = TaskResponse.model_validate(resultado.task).model_dump()
    return ArchiveTaskResponse(
        **task_data, cascade_count=resultado.cascade_count
    )


@router.post(
    "/{task_id}/unarchive",
    response_model=ArchiveTaskResponse,
    dependencies=[Depends(require_permission("task.archive"))],
)
async def unarchive_task(
    task_id: uuid.UUID, uow: UoWDep
) -> ArchiveTaskResponse:
    """Desarquiva a task e a subarvore. Idempotente.

    Recusa (422) quando o pai esta arquivado.
    """
    avisos = AvisosDaTarefa(uow.session)
    antes = await avisos.retrato(task_id)
    resultado = await TaskService(uow.session).unarchive(task_id=task_id)
    await avisos.depois_de_arquivar(antes, resultado.task)
    await uow.commit()
    task_data = TaskResponse.model_validate(resultado.task).model_dump()
    return ArchiveTaskResponse(
        **task_data, cascade_count=resultado.cascade_count
    )


@router.delete(
    "/{task_id}",
    response_model=DeleteTaskResponse,
    dependencies=[Depends(require_permission("task.delete"))],
)
async def delete_task(
    task_id: uuid.UUID, uow: UoWDep
) -> DeleteTaskResponse:
    """Soft-delete em cascata; `cascade_count` = filhas apagadas junto."""
    result = await TaskService(uow.session).soft_delete(task_id=task_id)
    await AvisosDaTarefa(uow.session).depois_de_excluir(result.task)
    await uow.commit()
    task_data = TaskResponse.model_validate(result.task).model_dump()
    return DeleteTaskResponse(**task_data, cascade_count=result.cascade_count)
