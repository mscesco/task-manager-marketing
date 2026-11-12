"""Router /me -- recursos do usuario logado (projeto pessoal e tarefas dele)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    MeRelation,
    MyAssignmentsResponse,
    MyTaskItem,
    TaskResponse,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.me_service import MeService
from app.modules.tasks.infrastructure.task_repository import (
    TaskRepository,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/me", tags=["me"])


_ALL_RELATIONS = frozenset({"assignee", "creator", "watcher"})


@router.get("/assignments", response_model=MyAssignmentsResponse)
async def list_my_assignments(
    _: TenantContextDep,
    session: SessionDep,
    relation: Annotated[list[MeRelation] | None, Query()] = None,
    page: int = 1,
    size: int = 20,
    under_team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta pelas minhas tarefas deste time e dos descendentes dele, "
            "pelo time EFETIVO. Ausente = de todos os times -- que aqui e um "
            "modo de uso, e nao um esquecimento: esta e a unica tela que "
            "atravessa times de proposito."
        ),
    ),
) -> MyAssignmentsResponse:
    """Tasks onde sou assignee/creator/watcher, dentro da lente de time.

    `relation` repetivel; ausente = as tres.
    """
    rels = frozenset(r.value for r in relation) if relation else _ALL_RELATIONS
    result = await MeService(session).list_assignments(
        PageParams(page=page, size=size),
        relations=rels,
        under_team_id=under_team_id,
    )
    # Responsaveis da pagina em uma query (lote), sem N+1.
    amap = await CollaborationService(session).assignee_ids_for_tasks(
        [row.task for row in result.items]
    )
    # Titulo da mae em lote: aqui a subtarefa aparece como card solto, e a mae
    # muitas vezes nao esta na pagina, entao o front nao resolve sozinho.
    pais = await TaskRepository(session).titles_for_ids(
        list({
            row.task.parent_task_id
            for row in result.items
            if row.task.parent_task_id is not None
        })
    )
    items = [
        MyTaskItem(
            **TaskResponse.model_validate(row.task).model_dump(),
            relations=sorted(row.relations),
            assignee_ids=amap.get(row.task.id, []),
            # None sem mae ou com mae fora do tenant; o front usa o rotulo generico.
            parent_title=(
                pais.get(row.task.parent_task_id)
                if row.task.parent_task_id
                else None
            ),
        )
        for row in result.items
    ]
    return MyAssignmentsResponse(
        items=items, total=result.total, page=result.page, size=result.size
    )
