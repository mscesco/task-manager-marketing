"""Rotas da Base (Spec 056) -- base e coluna (fatia B).

Cada rota cobra o VERBO da acao no portao (`require_permission`: "tem em ALGUM
lugar?"); o servico pergunta o mesmo verbo NO TIME DA BASE. Ver o topo de
`BaseService` para a ordem das respostas (403, 404, 403, 422/409).

Rotas:
    GET    /bases                                        -- base.read
    POST   /bases                                        -- base.create
    GET    /bases/{id}                                   -- base.read
    PATCH  /bases/{id}                                   -- base.update
    POST   /bases/{id}/columns                           -- base_column.create
    PATCH  /bases/{id}/columns/{column_id}               -- base_column.update
    DELETE /bases/{id}/columns/{column_id}               -- base_column.delete
    DELETE /bases/{id}/columns/{column_id}/options/{oid} -- base_column.delete

As de linha, visao e desfazer chegam na fatia C; excluir e restaurar, na D.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import require_permission
from app.modules.bases.api.schemas import (
    BaseCreateRequest,
    BaseResponse,
    BaseSummaryResponse,
    BaseUpdateRequest,
    ColumnCreateRequest,
    ColumnResponse,
    ColumnUpdateRequest,
)
from app.modules.bases.application.base_service import (
    BaseService,
    CreateBaseCommand,
    UpdateColumnCommand,
)

router = APIRouter(prefix="/bases", tags=["bases"])


# --------------------------------------------------------------- base
@router.get(
    "",
    response_model=list[BaseSummaryResponse],
    dependencies=[Depends(require_permission("base.read"))],
)
async def list_bases(session: SessionDep) -> list[BaseSummaryResponse]:
    bases = await BaseService(session).list_visible()
    return [BaseSummaryResponse.model_validate(b) for b in bases]


@router.post(
    "",
    response_model=BaseResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("base.create"))],
)
async def create_base(payload: BaseCreateRequest, uow: UoWDep) -> BaseResponse:
    detail = await BaseService(uow.session).create(
        CreateBaseCommand(
            name=payload.name, team_id=payload.team_id, description=payload.description
        )
    )
    await uow.commit()
    return BaseResponse.from_detail(detail)


@router.get(
    "/{base_id}",
    response_model=BaseResponse,
    dependencies=[Depends(require_permission("base.read"))],
)
async def get_base(base_id: uuid.UUID, session: SessionDep) -> BaseResponse:
    return BaseResponse.from_detail(await BaseService(session).get_detail(base_id))


@router.patch(
    "/{base_id}",
    response_model=BaseResponse,
    dependencies=[Depends(require_permission("base.update"))],
)
async def update_base(
    base_id: uuid.UUID, payload: BaseUpdateRequest, uow: UoWDep
) -> BaseResponse:
    detail = await BaseService(uow.session).update(
        base_id, name=payload.name, description=payload.description
    )
    await uow.commit()
    return BaseResponse.from_detail(detail)


# --------------------------------------------------------------- coluna
@router.post(
    "/{base_id}/columns",
    response_model=ColumnResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("base_column.create"))],
)
async def create_column(
    base_id: uuid.UUID, payload: ColumnCreateRequest, uow: UoWDep
) -> ColumnResponse:
    coluna = await BaseService(uow.session).create_column(
        base_id,
        name=payload.name,
        type=payload.type,
        options=[o.model_dump() for o in payload.options] if payload.options else None,
    )
    await uow.commit()
    return ColumnResponse.from_model(coluna)


@router.patch(
    "/{base_id}/columns/{column_id}",
    response_model=ColumnResponse,
    dependencies=[Depends(require_permission("base_column.update"))],
)
async def update_column(
    base_id: uuid.UUID,
    column_id: uuid.UUID,
    payload: ColumnUpdateRequest,
    uow: UoWDep,
) -> ColumnResponse:
    coluna = await BaseService(uow.session).update_column(
        base_id,
        column_id,
        UpdateColumnCommand(
            name=payload.name,
            type=payload.type,
            options=(
                [o.model_dump() for o in payload.options]
                if payload.options is not None
                else None
            ),
            position=payload.position,
            width=payload.width,
            fields_set=frozenset(payload.model_fields_set),
        ),
    )
    await uow.commit()
    return ColumnResponse.from_model(coluna)


@router.delete(
    "/{base_id}/columns/{column_id}",
    response_model=ColumnResponse,
    dependencies=[Depends(require_permission("base_column.delete"))],
)
async def delete_column(
    base_id: uuid.UUID, column_id: uuid.UUID, uow: UoWDep
) -> ColumnResponse:
    coluna = await BaseService(uow.session).delete_column(base_id, column_id)
    await uow.commit()
    return ColumnResponse.from_model(coluna)


@router.delete(
    "/{base_id}/columns/{column_id}/options/{option_id}",
    response_model=ColumnResponse,
    dependencies=[Depends(require_permission("base_column.delete"))],
)
async def delete_option(
    base_id: uuid.UUID, column_id: uuid.UUID, option_id: str, uow: UoWDep
) -> ColumnResponse:
    coluna = await BaseService(uow.session).delete_option(base_id, column_id, option_id)
    await uow.commit()
    return ColumnResponse.from_model(coluna)
