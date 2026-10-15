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

Fatia D:
    GET    /bases/trash                                  -- base.restore
    DELETE /bases/{id}                                   -- base.delete
    POST   /bases/{id}/restore                           -- base.restore
    (e a rotina diaria, em `/system/bases/purge` -- `tasks/api/system_router`)

Fatia G:
    GET    /bases/{id}/events                            -- base.read (SSE)

Fatia I (o cabecalho como o do Notion):
    POST   /bases/{id}/columns  com `position`           -- inserir no meio
    POST   /bases/{id}/columns/{column_id}/duplicate     -- base_column.create
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.deps import SessionDep, UoWDep
from app.core.logging import get_logger
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.bases.api.schemas import (
    BaseCreateRequest,
    BaseResponse,
    BaseSummaryResponse,
    BaseTrashItemResponse,
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
    RESTORE_WINDOW,
    BaseService,
    CreateBaseCommand,
    UpdateColumnCommand,
)
from app.modules.bases.application.export_service import BaseExportService
from app.modules.bases.application.import_service import (
    BaseImportService,
    ColumnPlan,
    ImportPlan,
)
from app.modules.bases.application.row_service import (
    ROW_LIMIT,
    ROW_WARNING,
    CellWrite,
    RowService,
)
from app.modules.bases.application.undo_service import UndoService
from app.modules.bases.application.view_service import ViewService
from app.modules.bases.infrastructure import live
from app.shared.exceptions.base import ValidationError

logger = get_logger(__name__)

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


# --------------------------------------------------------------- planilha (Spec 057)
class _ImportFile(BaseModel):
    """O arquivo em base64 (sem `python-multipart`: o corpo continua JSON)."""

    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=7_200_000)
    sheet: str | None = None
    header_row: int = Field(default=1, ge=1, le=100)

    def content(self) -> bytes:
        try:
            return base64.b64decode(self.content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValidationError("Arquivo invalido.", details={"field": "file"}) from exc


class _ImportColumn(BaseModel):
    index: int = Field(ge=0, le=500)
    action: str = Field(pattern="^(new|existing|title|ignore)$")
    name: str | None = Field(default=None, max_length=120)
    type: str | None = Field(default=None, max_length=30)
    column_id: uuid.UUID | None = None


class _ImportRequest(_ImportFile):
    base_id: uuid.UUID | None = None
    new_name: str | None = Field(default=None, max_length=120)
    new_team_id: uuid.UUID | None = None
    columns: list[_ImportColumn] = Field(max_length=500)
    dry_run: bool = True
    skip_invalid: bool = False


@router.post("/import/preview")
async def preview_import(_: TenantContextDep, payload: _ImportFile) -> dict:
    """Le a planilha: abas, cabecalho, 20 linhas e o tipo sugerido de cada coluna.
    Nao grava nada -- e o passo 1 do assistente."""
    p = BaseImportService(None).preview(  # type: ignore[arg-type]
        payload.content(), payload.filename, sheet=payload.sheet, header_row=payload.header_row
    )
    return {
        "sheets": p.sheets,
        "sheet": p.sheet,
        "header_row": p.header_row,
        "total_rows": p.total_rows,
        "columns": [
            {
                "index": c.index,
                "name": c.name,
                "suggested_type": c.suggested_type,
                "sample": c.sample,
            }
            for c in p.columns
        ],
    }


@router.post("/import")
async def run_import(_: TenantContextDep, payload: _ImportRequest, uow: UoWDep) -> dict:
    """Valida (`dry_run`) ou importa a planilha -- numa base que existe
    (`base_id`) ou numa nova (`new_name` + `new_team_id`). Uma acao do diario."""
    plan = ImportPlan(
        columns=[ColumnPlan(**c.model_dump()) for c in payload.columns],
        sheet=payload.sheet,
        header_row=payload.header_row,
        base_id=payload.base_id,
        new_name=payload.new_name,
        new_team_id=payload.new_team_id,
        dry_run=payload.dry_run,
        skip_invalid=payload.skip_invalid,
    )
    r = await BaseImportService(uow.session).run(payload.content(), payload.filename, plan)
    if not payload.dry_run:
        await uow.commit()
    return {
        "total": r.total,
        "valid": r.valid,
        "error_count": r.error_count,
        "errors": [{"line": e.line, "column": e.column, "message": e.message} for e in r.errors],
        "imported": r.imported,
        "base_id": str(r.base_id) if r.base_id else None,
    }


class _ExportRequest(BaseModel):
    format: str = Field(default="xlsx", pattern="^(xlsx|csv)$")
    row_ids: list[uuid.UUID] | None = Field(default=None, max_length=5_000)
    column_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)


@router.post("/{base_id}/export", response_class=Response)
async def export_base(
    base_id: uuid.UUID, payload: _ExportRequest, _: TenantContextDep, session: SessionDep
) -> Response:
    """A base em planilha, com as linhas e colunas DA VISAO que a tela mandou."""
    content, media, nome = await BaseExportService(session).export(
        base_id, fmt=payload.format, row_ids=payload.row_ids, column_ids=payload.column_ids
    )
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.get(
    "/trash",
    response_model=list[BaseTrashItemResponse],
    dependencies=[Depends(require_permission("base.restore"))],
)
async def list_trash(session: SessionDep) -> list[BaseTrashItemResponse]:
    """⚠️ DECLARADA ANTES de `/{base_id}`: na ordem inversa, "trash" seria lido
    como id da base e daria 422."""
    bases = await BaseService(session).list_trash()
    return [
        BaseTrashItemResponse(
            id=b.id,
            team_id=b.team_id,
            name=b.name,
            deleted_at=b.deleted_at,
            deleted_by=b.deleted_by,
            restorable_until=b.deleted_at + RESTORE_WINDOW,
        )
        for b in bases
    ]


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


@router.delete(
    "/{base_id}",
    response_model=BaseSummaryResponse,
    dependencies=[Depends(require_permission("base.delete"))],
)
async def delete_base(base_id: uuid.UUID, uow: UoWDep) -> BaseSummaryResponse:
    """Exclui (D5): fica 10 dias na lixeira. A confirmacao pelo nome (D26) e da
    tela."""
    base = await BaseService(uow.session).delete(base_id)
    await uow.commit()
    return BaseSummaryResponse.model_validate(base)


@router.post(
    "/{base_id}/restore",
    response_model=BaseResponse,
    dependencies=[Depends(require_permission("base.restore"))],
)
async def restore_base(base_id: uuid.UUID, uow: UoWDep) -> BaseResponse:
    detail = await BaseService(uow.session).restore(base_id)
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
        position=payload.position,
    )
    await uow.commit()
    return ColumnResponse.from_model(coluna)


@router.post(
    "/{base_id}/columns/{column_id}/duplicate",
    response_model=ColumnResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("base_column.create"))],
)
async def duplicate_column(
    base_id: uuid.UUID, column_id: uuid.UUID, uow: UoWDep
) -> ColumnResponse:
    """Fatia I: "Duplicar propriedade" -- com os valores, logo a direita."""
    coluna = await BaseService(uow.session).duplicate_column(base_id, column_id)
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


# --------------------------------------------------------------- ao vivo
#: Quanto um canal vive antes de se fechar (spec §10, fatia G).
#:
#: ⚠️⚠️ CURTO DE PROPOSITO. Cada reconexao passa de novo pelo portao e pelo
#: `base.read` NO TIME DA BASE -- e essa e a "releitura do verbo a cada 60 s"
#: da spec §5.7, sem um laco extra aqui dentro: quem perdeu o acesso (saiu do
#: time, conta desativada, papel trocado) nao reabre. E o token que vence
#: tambem nao reabre, e o front renova na recarga que faz ao reconectar.
CANAL_SEGUNDOS = 60.0
#: Comentario SSE a cada tanto, para proxy nenhum fechar o canal por silencio.
PING_SEGUNDOS = 15.0


@router.get(
    "/{base_id}/events",
    dependencies=[Depends(require_permission("base.read"))],
)
async def base_events(base_id: uuid.UUID, session: SessionDep) -> StreamingResponse:
    """O canal ao vivo de UMA base (Server-Sent Events).

    Cada `data:` e `{base_id, kind, actor_id}` -- so o AVISO de que mudou; quem
    recebe recarrega (ver `infrastructure/live.py`). `event: end` = o canal
    venceu, reconecte.

    ⚠️ A SESSAO E FECHADA ANTES DE TRANSMITIR: o canal fica aberto 60 s, e uma
    conexao do pool presa por navegador esgotaria o pool com uma dezena de
    pessoas olhando a mesma base.
    """
    await BaseService(session).get_detail(base_id)  # 404 se nao le
    await session.close()

    async def fluxo() -> AsyncIterator[str]:
        # ⚠️ A inscricao mora DENTRO do gerador: fora dele, um navegador que
        # desistisse antes de a transmissao comecar deixaria a fila inscrita
        # para sempre (o `finally` so roda se o gerador rodou).
        try:
            fila = await live.hub.subscribe(base_id)
        except Exception:  # a escuta nao abriu: o front cai na recarga de 10 s
            logger.exception("base.live.subscribe_failed", base_id=str(base_id))
            yield "event: unavailable\ndata: {}\n\n"
            return
        try:
            yield "retry: 3000\n\n"
            yield "event: ready\ndata: {}\n\n"
            fim = time.monotonic() + CANAL_SEGUNDOS
            while (resta := fim - time.monotonic()) > 0:
                try:
                    aviso = await asyncio.wait_for(fila.get(), timeout=min(PING_SEGUNDOS, resta))
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"data: {json.dumps(aviso)}\n\n"
            yield "event: end\ndata: {}\n\n"
        finally:
            live.hub.unsubscribe(base_id, fila)

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Para proxy que bufferiza por padrao (nginx); o Traefik nao
            # bufferiza, e a fatia confere na VPS com `curl -N`.
            "X-Accel-Buffering": "no",
        },
    )
