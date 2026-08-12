"""Router de Tasks. Submodulo do modulo tasks.

Padrao igual aos demais routers: DI, validacao, autorizacao,
status code. Regra de negocio mora no TaskService.

Rotas:
    GET    /tasks                   -- list (filtros + paginacao)
    POST   /tasks                   -- create (task.create)
    GET    /tasks/{id}              -- get
    PATCH  /tasks/{id}              -- update (task.update)
    POST   /tasks/{id}/move         -- move (task.update)
    POST   /tasks/{id}/archive      -- archive (task.update)
    POST   /tasks/{id}/unarchive    -- unarchive (task.update)
    DELETE /tasks/{id}              -- soft-delete CASCATEADO (task.delete)
"""

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
    TaskResponse,
    TaskUpdateRequest,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    MoveTaskCommand,
    TaskFilters,
    TaskService,
    UpdateTaskCommand,
)
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
    created_by: uuid.UUID | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
) -> TaskListResponse:
    """Lista tasks do workspace, paginado, com filtros.

    PRIVACIDADE: tasks em pessoal alheio nao aparecem.
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
            created_by=created_by,
            include_archived=include_archived,
            archived_only=archived_only,
        ),
    )
    # Selo de responsaveis: assignees da pagina inteira em UMA query (lote),
    # nao 1 por card (Entrega 10 / ADR 0025).
    amap = await CollaborationService(session).assignee_ids_for_tasks(
        page_result.items
    )
    return TaskListResponse(
        items=[
            TaskListItem.model_validate(t).model_copy(
                update={"assignee_ids": amap.get(t.id, [])}
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
    """Obtem task pelo id. Pessoal alheio -> 404.

    Detalhe inclui assignee_ids / watcher_ids (so IDs). A listagem
    (GET /tasks) NAO os inclui -- mantem a query enxuta (decisao 9).
    """
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

    Responde **TaskListItem** (com `assignee_ids`), nao `TaskResponse`.

    O ADR 0025 poe `POST`/`PATCH`/`/move`/`/archive` no mesmo balaio: nenhum
    devolve `assignee_ids`, para uma mutacao nao zerar o selo do card. O
    raciocinio vale para PATCH/move/archive -- que nao tocam em responsavel --
    mas **envelheceu para o POST**: a Spec 021 deu a criacao a capacidade de
    DEFINIR responsaveis, e o ADR e anterior a ela.

    Sintoma real (relatado em 2026-07-27): criar tarefa com responsavel
    gravava certo no banco e o card nascia sem ninguem, porque o front recebia
    a resposta sem o campo e caia no ramo `?? []` do merge.

    Correcao cirurgica: SO o POST muda. PATCH/move/archive seguem com
    `TaskResponse` e a protecao do ADR fica intacta. Ver a emenda no
    `docs/adr/0025-listagem-traz-assignees-em-lote.md`.
    """
    task = await TaskService(uow.session).create(
        CreateTaskCommand(
            project_id=payload.project_id,
            title=payload.title,
            description=payload.description,
            parent_task_id=payload.parent_task_id,
            team_id=payload.team_id,
            # ⚠️ Spec 036, fatia 5b-6. MESMA ARMADILHA do `assignee_ids` logo
            # abaixo, e ela ja mordeu este arquivo uma vez: sem esta linha o
            # campo chega no payload e e DESCARTADO -- a tarefa nasce no Quadro
            # geral, sem erro nenhum, e a pessoa que a criou dentro do quadro
            # avulso nao a encontra mais. Coberto por
            # `test_task_nasce_no_quadro_pedido_db.py`.
            board_id=payload.board_id,
            status=payload.status,
            priority=payload.priority,
            start_date=payload.start_date,
            due_date=payload.due_date,
            # Spec 021: responsaveis ja na criacao. Sem esta linha o campo
            # chega no payload e e descartado -- a task nasce sem responsavel,
            # sem erro (o CreateTaskCommand tem default []). Coberto por
            # test_task_create_assignees_http_db.py (fatia HTTP).
            assignee_ids=payload.assignee_ids,
        )
    )
    # Le do BANCO o que foi de fato gravado -- nao ecoa payload.assignee_ids.
    # Se um dia a atribuicao filtrar/deduplicar, a resposta acompanha sozinha.
    # Antes do commit, de proposito: mesma transacao que criou.
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
    """Duplica a task `task_id` (Spec 033).

    ⚠️ MESMA permissao de criar (`task.create`), mais a visibilidade da
    origem, que o service confere. Nao existe permissao de "duplicar": criar
    uma copia e criar uma task, e inventar permissao nova aqui daria a alguem
    a chance de duplicar sem poder criar.

    ⚠️ Rota NOMEADA em vez de um `copy_subtasks_from` no POST comum. A
    alternativa tem menos superficie, mas contrabandearia a LEITURA de outro
    agregado pra dentro de uma criacao generica -- a autorizacao de "posso ver
    a origem?" ficaria implicita num endpoint cujo contrato e "crio uma task".

    Origem invisivel -> 404, nao 403 (criterio 11): nao se confirma a
    existencia de uma task fora do escopo de quem pergunta.
    """
    resultado = await TaskService(uow.session).duplicate(
        DuplicateTaskCommand(
            source_id=task_id,
            title=payload.title,
            description=payload.description,
            project_id=payload.project_id,
            parent_task_id=payload.parent_task_id,
            team_id=payload.team_id,
            priority=payload.priority,
            assignee_ids=payload.assignee_ids,
            include_subtasks=payload.include_subtasks,
            include_assignees=payload.include_assignees,
            subtask_assignees=payload.subtask_assignees,
            skip_subtasks=payload.skip_subtasks,
        )
    )
    # Le do BANCO, mesmo motivo do POST comum: nao ecoar o payload.
    # Antes do commit, de proposito -- mesma transacao que criou a arvore.
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
    """Patch parcial. project_id e parent_task_id NAO entram (usar move).

    ⚠️ Aceita `status` OU `column_id` (ADR 0041). Com `column_id`, a coluna e a
    fonte e o status e derivado dela -- pela ponte `legacy_status` quando ela
    existe, pela semantica quando nao. Os dois juntos: 422, no schema.
    """
    # ⚠️ ADR 0041 (D3) -- RECUSA, E NAO PRECEDENCIA. Os dois campos escrevem a
    # mesma dupla (status, coluna) por caminhos opostos; qualquer ordem de
    # precedencia faria um deles ser ignorado EM SILENCIO.
    #
    # ⚠️ Olha `model_fields_set`, e nao o valor: `status: null` explicito junto
    # com `column_id` tambem e conflito -- o cliente esta dizendo duas coisas
    # sobre o mesmo campo na mesma requisicao.
    #
    # ⚠️ AQUI, E NAO NUM `@model_validator` DO SCHEMA. Medido: o validador do
    # Pydantic devolve 500 neste projeto (ver o comentario no schema).
    veio = payload.model_fields_set
    if "status" in veio and "column_id" in veio:
        raise ValidationError(
            "Mande `status` OU `column_id`, nunca os dois: os dois escrevem "
            "a mesma dupla (status, coluna).",
            details={"field": "column_id"},
        )

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
            # ADR 0041: quando vem, ele manda e o status e derivado dele. O
            # schema ja garantiu que nao veio junto com `status`.
            column_id=payload.column_id,
            # Campos presentes no PATCH (mesmo com valor None) -> permite LIMPAR
            # datas. Sem isto, null explicito virava "nao mexer" (bug).
            fields_set=frozenset(payload.model_fields_set),
        ),
    )
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
    "/{task_id}/archive",
    response_model=ArchiveTaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def archive_task(task_id: uuid.UUID, uow: UoWDep) -> ArchiveTaskResponse:
    """Arquiva a task E a subarvore (05/08). Idempotente.

    `cascade_count` = subtarefas arquivadas junto (nao conta a propria).
    """
    resultado = await TaskService(uow.session).archive(task_id=task_id)
    await uow.commit()
    task_data = TaskResponse.model_validate(resultado.task).model_dump()
    return ArchiveTaskResponse(
        **task_data, cascade_count=resultado.cascade_count
    )


@router.post(
    "/{task_id}/unarchive",
    response_model=ArchiveTaskResponse,
    dependencies=[Depends(require_permission("task.update"))],
)
async def unarchive_task(
    task_id: uuid.UUID, uow: UoWDep
) -> ArchiveTaskResponse:
    """Desarquiva a task E a subarvore (05/08). Idempotente.

    Recusa (422) quando o PAI esta arquivado -- ver `TaskService.unarchive`.
    """
    resultado = await TaskService(uow.session).unarchive(task_id=task_id)
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
    """Soft-delete CASCATEADO (ADR 0005).

    Resposta inclui `cascade_count` (numero de filhas apagadas junto).
    """
    result = await TaskService(uow.session).soft_delete(task_id=task_id)
    await uow.commit()
    # Combina campos do TaskResponse com cascade_count.
    task_data = TaskResponse.model_validate(result.task).model_dump()
    return DeleteTaskResponse(**task_data, cascade_count=result.cascade_count)
