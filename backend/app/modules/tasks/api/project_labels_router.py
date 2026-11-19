"""Routers /project-categories e /project-tags: o catalogo do time raiz.

Ler: quem ve o time raiz. Criar, renomear, trocar a cor e apagar: quem tem
`project.update` nele (conferido no servico, que conhece o time).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status

from app.core.deps import SessionDep, UoWDep
from app.db.models import ProjectCategory, ProjectTag
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    ProjectLabelCreateRequest,
    ProjectLabelResponse,
    ProjectLabelUpdateRequest,
)
from app.modules.tasks.application.project_label_service import (
    LabelModel,
    ProjectLabelService,
)


def _router(prefix: str, model: LabelModel) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=["projects"])

    @router.get("", response_model=list[ProjectLabelResponse])
    async def listar(
        _: TenantContextDep,
        session: SessionDep,
        team_id: uuid.UUID | None = Query(
            None, description="Catalogo da raiz deste time. Ausente = todas as raizes visiveis."
        ),
    ) -> list[ProjectLabelResponse]:
        itens = await ProjectLabelService(session, model).list(team_id)
        return [ProjectLabelResponse.model_validate(i) for i in itens]

    @router.post(
        "", response_model=ProjectLabelResponse, status_code=status.HTTP_201_CREATED
    )
    async def criar(
        payload: ProjectLabelCreateRequest, _: TenantContextDep, uow: UoWDep
    ) -> ProjectLabelResponse:
        label = await ProjectLabelService(uow.session, model).create(
            team_id=payload.team_id, name=payload.name, color=payload.color
        )
        resposta = ProjectLabelResponse.model_validate(label)
        await uow.commit()
        return resposta

    @router.patch("/{label_id}", response_model=ProjectLabelResponse)
    async def editar(
        label_id: uuid.UUID,
        payload: ProjectLabelUpdateRequest,
        _: TenantContextDep,
        uow: UoWDep,
    ) -> ProjectLabelResponse:
        label = await ProjectLabelService(uow.session, model).update(
            label_id=label_id, name=payload.name, color=payload.color
        )
        resposta = ProjectLabelResponse.model_validate(label)
        await uow.commit()
        return resposta

    @router.delete(
        "/{label_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    async def apagar(label_id: uuid.UUID, _: TenantContextDep, uow: UoWDep) -> Response:
        await ProjectLabelService(uow.session, model).delete(label_id=label_id)
        await uow.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


categories_router = _router("/project-categories", ProjectCategory)
tags_router = _router("/project-tags", ProjectTag)
