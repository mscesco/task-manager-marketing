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

Fatia C:
    GET    /bases/{id}/rows                              -- base.read
    POST   /bases/{id}/rows                              -- base_row.create
    PATCH  /bases/{id}/rows/{row_id}                     -- base_row.update
    PATCH  /bases/{id}/cells                             -- base_row.update (lote)
    DELETE /bases/{id}/rows/{row_id}                     -- base_row.delete
    POST   /bases/{id}/views                             -- base_view.create
    PATCH  /bases/{id}/views/{view_id}                   -- base_view.update
    DELETE /bases/{id}/views/{view_id}                   -- base_view.delete
    POST   /bases/{id}/undo                              -- base.read (+ o verbo
    POST   /bases/{id}/redo                                 da acao, no servico)

Excluir e restaurar a base chegam na fatia D.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import require_permission
from app.modules.bases.api.schemas import (
    BaseCreateRequest,
    BaseResponse,
    BaseSummaryResponse,
    BaseUpdateRequest,
    CellsUpdateRequest,
    ColumnCreateRequest,
    ColumnResponse,
    ColumnUpdateRequest,
    RowCreateRequest,
    RowListResponse,
    RowResponse,
    RowUpdateRequest,
    UndoResponse,
    ViewCreateRequest,
    ViewResponse,
    ViewUpdateRequest,
)
from app.modules.bases.application.base_service import (
    BaseService,
    CreateBaseCommand,
    UpdateColumnCommand,
)
from app.modules.bases.application.row_service import (
    ROW_LIMIT,
    ROW_WARNING,
    CellWrite,
    RowService,
)
from app.modules.bases.application.undo_service import UndoService
from app.modules.bases.application.view_service import ViewService

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


# --------------------------------------------------------------- linha
@router.get(
    "/{base_id}/rows",
    response_model=RowListResponse,
    dependencies=[Depends(require_permission("base.read"))],
)
async def list_rows(base_id: uuid.UUID, session: SessionDep) -> RowListResponse:
    linhas = await RowService(session).list_rows(base_id)
    return RowListResponse(
        items=[RowResponse.model_validate(r) for r in linhas],
        total=len(linhas),
        limit=ROW_LIMIT,
        warning_at=ROW_WARNING,
    )


@router.post(
    "/{base_id}/rows",
    response_model=RowResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("base_row.create"))],
)
async def create_row(
    base_id: uuid.UUID, payload: RowCreateRequest, uow: UoWDep
) -> RowResponse:
    linha = await RowService(uow.session).create_row(base_id, payload.values)
    await uow.commit()
    return RowResponse.model_validate(linha)


@router.patch(
    "/{base_id}/rows/{row_id}",
    response_model=RowResponse,
    dependencies=[Depends(require_permission("base_row.update"))],
)
async def update_row(
    base_id: uuid.UUID, row_id: uuid.UUID, payload: RowUpdateRequest, uow: UoWDep
) -> RowResponse:
    linha = await RowService(uow.session).update_row(base_id, row_id, payload.values)
    await uow.commit()
    return RowResponse.model_validate(linha)


@router.patch(
    "/{base_id}/cells",
    response_model=list[RowResponse],
    dependencies=[Depends(require_permission("base_row.update"))],
)
async def update_cells(
    base_id: uuid.UUID, payload: CellsUpdateRequest, uow: UoWDep
) -> list[RowResponse]:
    linhas = await RowService(uow.session).update_cells(
        base_id,
        [CellWrite(row_id=c.row_id, column_id=c.column_id, value=c.value) for c in payload.cells],
    )
    await uow.commit()
    return [RowResponse.model_validate(r) for r in linhas]


@router.delete(
    "/{base_id}/rows/{row_id}",
    response_model=RowResponse,
    dependencies=[Depends(require_permission("base_row.delete"))],
)
async def delete_row(
    base_id: uuid.UUID, row_id: uuid.UUID, uow: UoWDep
) -> RowResponse:
    linha = await RowService(uow.session).delete_row(base_id, row_id)
    await uow.commit()
    return RowResponse.model_validate(linha)


# --------------------------------------------------------------- visao
@router.post(
    "/{base_id}/views",
    response_model=ViewResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("base_view.create"))],
)
async def create_view(
    base_id: uuid.UUID, payload: ViewCreateRequest, uow: UoWDep
) -> ViewResponse:
    visao = await ViewService(uow.session).create(
        base_id, name=payload.name, layout=payload.layout, config=payload.config
    )
    await uow.commit()
    return ViewResponse.model_validate(visao)


@router.patch(
    "/{base_id}/views/{view_id}",
    response_model=ViewResponse,
    dependencies=[Depends(require_permission("base_view.update"))],
)
async def update_view(
    base_id: uuid.UUID, view_id: uuid.UUID, payload: ViewUpdateRequest, uow: UoWDep
) -> ViewResponse:
    visao = await ViewService(uow.session).update(
        base_id,
        view_id,
        name=payload.name,
        config=payload.config,
        position=payload.position,
    )
    await uow.commit()
    return ViewResponse.model_validate(visao)


@router.delete(
    "/{base_id}/views/{view_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_permission("base_view.delete"))],
)
async def delete_view(base_id: uuid.UUID, view_id: uuid.UUID, uow: UoWDep) -> Response:
    await ViewService(uow.session).delete(base_id, view_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------- desfazer
@router.post(
    "/{base_id}/undo",
    response_model=UndoResponse,
    dependencies=[Depends(require_permission("base.read"))],
)
async def undo(base_id: uuid.UUID, uow: UoWDep) -> UndoResponse:
    r = await UndoService(uow.session).undo(base_id)
    await uow.commit()
    return UndoResponse(applied=r.applied, conflict=r.conflict, kind=r.kind)


@router.post(
    "/{base_id}/redo",
    response_model=UndoResponse,
    dependencies=[Depends(require_permission("base.read"))],
)
async def redo(base_id: uuid.UUID, uow: UoWDep) -> UndoResponse:
    r = await UndoService(uow.session).redo(base_id)
    await uow.commit()
    return UndoResponse(applied=r.applied, conflict=r.conflict, kind=r.kind)
