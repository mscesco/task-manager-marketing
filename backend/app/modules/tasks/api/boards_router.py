"""Router de quadros e colunas.

As rotas de escrita nao tem `require_permission`: a permissao depende do time
do alvo (raiz: `board.manage.root`; subtime: `board.manage.subteam` + ser
supervisor dele), e quem sabe o alvo e `BoardService._assert_pode_gerir`.
A leitura e restrita pela lente na consulta do repositorio.

`_: TenantContextDep` parece nao usado mas e obrigatorio: e ele que popula o
contexto de tenant; sem ele `require_tenant()` estoura `missing_tenant_context`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.core.deps import SessionDep, UoWDep
from app.db.models.boards import Board, BoardColumn
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    BoardColumnDetailResponse,
    BoardColumnResponse,
    BoardColumnsBatchRequest,
    BoardColumnsBatchResponse,
    BoardCreateRequest,
    BoardDeleteResponse,
    BoardDetailResponse,
    BoardRenameRequest,
    BoardResponse,
    TaskSearchHitResponse,
)
from app.modules.tasks.application.board_service import (
    BoardService,
    LoteApagar,
    LoteAviso,
    LoteCriar,
    LoteRenomear,
)
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository

router = APIRouter(prefix="/boards", tags=["boards"])


@router.get("", response_model=list[BoardResponse])
async def list_boards(
    _: TenantContextDep, session: SessionDep
) -> list[BoardResponse]:
    """Quadros que o usuario alcanca pela lente, sem os apagados. Sem paginacao."""
    quadros = await BoardRepository(session).list_visible()
    return [
        BoardResponse(
            id=quadro.id,
            name=quadro.name,
            team_id=quadro.team_id,
            is_default=quadro.is_default,
            colunas=[
                BoardColumnResponse.model_validate(coluna) for coluna in colunas
            ],
        )
        for quadro, colunas in quadros
    ]


async def _resposta(session, quadro: Board) -> BoardResponse:
    """Monta o `BoardResponse` lendo as colunas do banco, ordenadas por `position`."""
    colunas = (
        (
            await session.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == quadro.id)
                .order_by(BoardColumn.position)
            )
        )
        .scalars()
        .all()
    )
    return BoardResponse(
        id=quadro.id,
        name=quadro.name,
        team_id=quadro.team_id,
        is_default=quadro.is_default,
        colunas=[BoardColumnResponse.model_validate(c) for c in colunas],
    )


@router.post(
    "",
    response_model=BoardResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_board(
    payload: BoardCreateRequest, _: TenantContextDep, uow: UoWDep
) -> BoardResponse:
    """Cria um quadro avulso para `team_id`, com as quatro colunas base."""
    quadro = await BoardService(uow.session).criar_quadro(
        team_id=payload.team_id, nome=payload.name
    )
    resposta = await _resposta(uow.session, quadro)
    await uow.commit()
    return resposta


@router.patch("/{board_id}", response_model=BoardResponse)
async def rename_board(
    board_id: uuid.UUID,
    payload: BoardRenameRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> BoardResponse:
    """Renomeia um quadro (inclusive o geral). Nao mexe em colunas.

    404 vem antes de 403: 403 confirmaria que o quadro de outro workspace existe.
    """
    quadro = await BoardService(uow.session).renomear_quadro(
        board_id=board_id, nome=payload.name
    )
    resposta = await _resposta(uow.session, quadro)
    await uow.commit()
    return resposta


@router.get("/{board_id}", response_model=BoardDetailResponse)
async def get_board(
    board_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> BoardDetailResponse:
    """Um quadro, com as colunas e a contagem de tarefas vivas (para o aviso de apagar).

    A contagem e de um instante; o `DELETE` devolve quantas apagou de fato.
    """
    quadro = await BoardService(session).quadro_visivel(board_id)
    base = await _resposta(session, quadro)
    return BoardDetailResponse(
        **base.model_dump(),
        task_count=await BoardService(session).contar_tarefas_do_quadro(
            quadro.id
        ),
    )


@router.get(
    "/{board_id}/tasks/search", response_model=list[TaskSearchHitResponse]
)
async def search_board_tasks(
    board_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
    q: str = Query("", max_length=200),
    exclude_task_id: uuid.UUID | None = None,
) -> list[TaskSearchHitResponse]:
    """Tarefas de qualquer nivel do quadro, com o caminho (o "Subtarefa de..." do mover).

    `exclude_task_id` tira a tarefa movida e a subarvore dela. Quadro fora da lente: 404.
    """
    await BoardService(session).quadro_visivel(board_id)
    repo = TaskRepository(session)
    # Sem 404: um 404 aqui diria se a tarefa existe.
    excluir = (
        await repo.get_by_id(exclude_task_id) if exclude_task_id is not None else None
    )
    achados = await repo.buscar_no_quadro(board_id=board_id, q=q, excluir=excluir)
    return [
        TaskSearchHitResponse(
            id=t.id, title=t.title, team_id=t.team_id, depth=t.depth, caminho=caminho
        )
        for t, caminho in achados
    ]


@router.delete("/{board_id}", response_model=BoardDeleteResponse)
async def delete_board(
    board_id: uuid.UUID, _: TenantContextDep, uow: UoWDep
) -> BoardDeleteResponse:
    """Apaga o quadro e as tarefas dentro dele, sem perguntar destino.

    A confirmacao (digitar o nome) e da tela. Resgate so por
    `backend/scripts/restaurar_quadro.sql`. O quadro padrao recusa.
    """
    apagadas = await BoardService(uow.session).apagar_quadro(board_id=board_id)
    await uow.commit()
    return BoardDeleteResponse(tarefas_apagadas=apagadas)


# =====================================================================
# COLUNAS
#
# Rotas aninhadas em `/boards/{board_id}/` de proposito: a autorizacao depende
# do time do quadro, e o servico confere que a coluna pertence a ele.
# =====================================================================


@router.put(
    "/{board_id}/columns",
    response_model=BoardColumnsBatchResponse,
)
async def apply_columns_batch(
    board_id: uuid.UUID,
    payload: BoardColumnsBatchRequest,
    _: TenantContextDep,
    uow: UoWDep,
) -> BoardColumnsBatchResponse:
    """Aplica a edicao inteira de colunas de um quadro, numa transacao so.

    Qualquer recusa desfaz o lote todo. Recusas sao 422 com `code`; o front le
    o `code`, nunca a mensagem.
    """
    colunas, movidas = await BoardService(uow.session).aplicar_lote(
        board_id=board_id,
        # Traducao schema -> dominio aqui: `application/` nao importa de `api/`.
        criar=[
            # Campo a campo: campo novo no schema precisa ser repassado aqui.
            LoteCriar(
                tmp=c.tmp,
                name=c.name,
                semantic=c.semantic,
                color=c.color,
                notify_deadline=c.notify_deadline,
            )
            for c in payload.criar
        ],
        renomear=[
            LoteRenomear(id=r.id, name=r.name) for r in payload.renomear
        ],
        avisos=[
            LoteAviso(id=a.id, notify_deadline=a.notify_deadline)
            for a in payload.avisos
        ],
        alvos=list(payload.alvos),
        apagar=[
            LoteApagar(id=a.id, destino=a.destino) for a in payload.apagar
        ],
        ordem=payload.ordem,
    )
    resposta = BoardColumnsBatchResponse(
        colunas=[BoardColumnResponse.model_validate(c) for c in colunas],
        movidas=movidas,
    )
    await uow.commit()
    return resposta


@router.get(
    "/{board_id}/columns/{column_id}",
    response_model=BoardColumnDetailResponse,
)
async def get_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
) -> BoardColumnDetailResponse:
    """A coluna, com quantas tarefas vivas ela tem (para o aviso de apagar).

    Exige alcancar o quadro pela lente, nao permissao de escrita.
    """
    contagem = await BoardService(session).contar_tarefas_da_coluna(
        board_id=board_id, column_id=column_id
    )
    coluna = (
        await session.execute(
            select(BoardColumn).where(
                BoardColumn.id == column_id, BoardColumn.board_id == board_id
            )
        )
    ).scalar_one()
    return BoardColumnDetailResponse(
        **BoardColumnResponse.model_validate(coluna).model_dump(),
        task_count=contagem,
    )
