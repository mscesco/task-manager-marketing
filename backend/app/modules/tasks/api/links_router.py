"""Links com nome de PROJETO e de TAREFA (Spec 052, fatia B).

Rotas:
    GET /tasks/{task_id}/links         -- quem enxerga a tarefa
    PUT /tasks/{task_id}/links         -- quem edita a tarefa (substitui a lista)
    GET /projects/{project_id}/links   -- quem enxerga o projeto
    PUT /projects/{project_id}/links   -- quem edita o projeto (substitui a lista)

⚠️ `PUT` COM A LISTA INTEIRA, e nao uma rota por link (§4.2): a tela edita a
lista num painel so e salva de uma vez, e aqui e uma transacao -- ou a lista
nova inteira, ou nada. O portao da rota e o verbo "em algum lugar"; o "neste
time" e a lente moram no `LinkService`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.tasks.api.schemas import LinkResponse, LinksReplaceRequest
from app.modules.tasks.application.link_service import LinkService

router = APIRouter(tags=["links"])


@router.get("/tasks/{task_id}/links", response_model=list[LinkResponse])
async def list_task_links(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[LinkResponse]:
    links = await LinkService(session).list_task_links(task_id)
    return [LinkResponse.model_validate(a) for a in links]


@router.put(
    "/tasks/{task_id}/links",
    response_model=list[LinkResponse],
    dependencies=[Depends(require_permission("task.update"))],
)
async def replace_task_links(
    task_id: uuid.UUID, payload: LinksReplaceRequest, uow: UoWDep
) -> list[LinkResponse]:
    links = await LinkService(uow.session).replace_task_links(
        task_id, [(item.title, item.url) for item in payload.links]
    )
    resposta = [LinkResponse.model_validate(a) for a in links]
    await uow.commit()
    return resposta


@router.get("/projects/{project_id}/links", response_model=list[LinkResponse])
async def list_project_links(
    project_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[LinkResponse]:
    links = await LinkService(session).list_project_links(project_id)
    return [LinkResponse.model_validate(a) for a in links]


@router.put(
    "/projects/{project_id}/links",
    response_model=list[LinkResponse],
    dependencies=[Depends(require_permission("project.update"))],
)
async def replace_project_links(
    project_id: uuid.UUID, payload: LinksReplaceRequest, uow: UoWDep
) -> list[LinkResponse]:
    links = await LinkService(uow.session).replace_project_links(
        project_id, [(item.title, item.url) for item in payload.links]
    )
    resposta = [LinkResponse.model_validate(a) for a in links]
    await uow.commit()
    return resposta
