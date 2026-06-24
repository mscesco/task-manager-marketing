"""Router /me -- recursos do user logado.

Por ora expoe apenas o projeto pessoal. Quando vierem /me/tasks,
/me/assignments etc., entram aqui.

Vive no modulo `tasks` porque o conteudo retornado eh um projeto.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    MeRelation,
    MyAssignmentsResponse,
    MyTaskItem,
    ProjectResponse,
    TaskResponse,
)
from app.modules.tasks.application.me_service import MeService
from app.modules.tasks.application.project_service import ProjectService
from app.shared.pagination import PageParams

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/personal-project", response_model=ProjectResponse)
async def get_my_personal_project(_: TenantContextDep, session: SessionDep) -> ProjectResponse:
    """Retorna o projeto pessoal do user logado.

    O pessoal eh criado automaticamente no provisionamento e no
    cadastro de membro (ver ADR 0001), entao em condicao normal
    sempre existe. Se nao existir, devolve 404 (sinal de bug ou
    banco inconsistente -- logamos com severidade alta).
    """
    project = await ProjectService(session).get_personal_for_current_user()
    return ProjectResponse.model_validate(project)


_ALL_RELATIONS = frozenset({"assignee", "creator", "watcher"})


@router.get("/assignments", response_model=MyAssignmentsResponse)
async def list_my_assignments(
    _: TenantContextDep,
    session: SessionDep,
    relation: Annotated[list[MeRelation] | None, Query()] = None,
    page: int = 1,
    size: int = 20,
) -> MyAssignmentsResponse:
    """Tasks onde sou assignee/creator/watcher (ADR 0017/0018).

    `relation` repetivel; ausente = as tres. Valor invalido -> 422 (enum
    validado pelo FastAPI). So leitura: ver `out_of_scope` NAO implica
    poder editar (edicao segue presa a lente de time, ADR 0013).
    """
    rels = frozenset(r.value for r in relation) if relation else _ALL_RELATIONS
    result = await MeService(session).list_assignments(
        PageParams(page=page, size=size), relations=rels
    )
    items = [
        MyTaskItem(
            **TaskResponse.model_validate(row.task).model_dump(),
            relations=sorted(row.relations),
            out_of_scope=row.out_of_scope,
        )
        for row in result.items
    ]
    return MyAssignmentsResponse(
        items=items, total=result.total, page=result.page, size=result.size
    )
