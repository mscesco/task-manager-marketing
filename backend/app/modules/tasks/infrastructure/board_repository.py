"""Leitura de quadro e coluna.

A direcao e `status -> coluna`: `board_column.legacy_status` e a ponte 1:1.

Soft delete: este repositorio nao estende `BaseRepository`, entao cada consulta
decide. Consulta que DESCOBRE um quadro filtra `deleted_at`; consulta que RECEBE
o `board_id` nao filtra (tarefa viva em quadro apagado nao deve existir -- a
consulta 4 de `scripts/invariantes.sql` confere).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.board_semantics import (
    semantica_do_status,
    status_da_coluna,
)
from app.shared.exceptions.base import ValidationError


class BoardRepository:
    """Consultas de quadro. Sem escrita -- quem cria quadro e o BoardService."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def default_board_and_column_for_status(
        self, status: TaskStatus, *, root_team_id: uuid.UUID
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """`(board_id, column_id)` do quadro geral do time raiz, para tarefa de topo.

        Mesma ordem de `coluna_para_status`: ponte primeiro, alvo da semantica
        depois. Sem quadro ou sem coluna, `ValidationError` (sem fallback, para
        nao gravar na coluna errada em silencio).
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT b.id, c.id
                    FROM board b
                    JOIN board_column c
                      ON c.board_id = b.id
                     AND (
                       c.legacy_status = CAST(:status AS task_status)
                       OR (
                         c.is_default_target
                         AND c.semantic = CAST(:semantica AS column_semantic)
                       )
                     )
                    WHERE b.workspace_id = :ws
                      AND b.team_id = :root_team_id
                      AND b.is_default
                      AND b.deleted_at IS NULL
                    ORDER BY (c.legacy_status = CAST(:status AS task_status))
                             DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {
                    "ws": tenant.workspace_id,
                    "root_team_id": root_team_id,
                    "status": status.value,
                    "semantica": semantica_do_status(status).value,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                "Este time nao tem quadro geral com coluna para o status "
                f"{status.value}, nem coluna de destino para a semantica "
                f"{semantica_do_status(status).value}.",
                details={
                    "field": "status",
                    "status": status.value,
                    "root_team_id": str(root_team_id),
                },
            )
        return linha[0], linha[1]

    async def coluna_para_status(
        self, *, board_id: uuid.UUID, status: TaskStatus
    ) -> tuple[uuid.UUID, TaskStatus]:
        """`(column_id, status_efetivo)` do status dentro de `board_id`; nao escolhe quadro.

        Degraus: 1) coluna com `legacy_status = status`; 2) coluna
        `is_default_target` da semantica do status; senao `ValidationError`.
        O status efetivo sai sempre da coluna (`status_da_coluna`).

        `DESC NULLS LAST` e obrigatorio: a comparacao da NULL em coluna sem
        ponte, e sem ele o degrau 2 ganharia do 1.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT c.id, c.legacy_status, c.semantic
                    FROM board_column c
                    WHERE c.board_id = :board
                      AND c.workspace_id = :ws
                      AND (
                        c.legacy_status = CAST(:status AS task_status)
                        OR (
                          c.is_default_target
                          AND c.semantic = CAST(:semantica AS column_semantic)
                        )
                      )
                    ORDER BY (c.legacy_status = CAST(:status AS task_status))
                             DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {
                    "board": board_id,
                    "ws": tenant.workspace_id,
                    "status": status.value,
                    "semantica": semantica_do_status(status).value,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                f"O quadro desta tarefa nao tem coluna para o status "
                f"{status.value}, nem coluna de destino para a semantica "
                f"{semantica_do_status(status).value}.",
                details={
                    "field": "status",
                    "status": status.value,
                    "board_id": str(board_id),
                },
            )

        # `text()` devolve string crua do driver; converte para enum.
        ponte, semantica = linha[1], linha[2]
        return linha[0], status_da_coluna(
            legacy_status=TaskStatus(ponte) if ponte is not None else None,
            semantic=ColumnSemantic(semantica),
        )

    async def coluna_no_quadro(
        self, *, board_id: uuid.UUID, column_id: uuid.UUID
    ) -> tuple[TaskStatus | None, ColumnSemantic]:
        """Ponte e semantica de uma coluna, exigindo que ela seja de `board_id`.

        Coluna inexistente e coluna de outro quadro dao o mesmo
        `ValidationError`, para nao vazar a existencia da coluna.
        """
        tenant = require_tenant()
        linha = (
            await self.session.execute(
                text(
                    """
                    SELECT c.legacy_status, c.semantic
                    FROM board_column c
                    WHERE c.id = :coluna
                      AND c.board_id = :board
                      AND c.workspace_id = :ws
                    """
                ),
                {
                    "coluna": column_id,
                    "board": board_id,
                    "ws": tenant.workspace_id,
                },
            )
        ).first()

        if linha is None:
            raise ValidationError(
                "A coluna informada nao pertence ao quadro desta tarefa.",
                details={
                    "field": "column_id",
                    "column_id": str(column_id),
                    "board_id": str(board_id),
                },
            )

        ponte, semantica = linha
        return (
            TaskStatus(ponte) if ponte is not None else None,
            ColumnSemantic(semantica),
        )

    async def dono_do_quadro(
        self, board_id: uuid.UUID
    ) -> tuple[uuid.UUID, bool] | None:
        """`(team_id, is_default)` do quadro, ou `None` se ele nao existe.

        Nao filtra `deleted_at`: filtrar faria a trava de time da tarefa sumir
        para quadro apagado.
        """
        linha = (
            await self.session.execute(
                select(Board.team_id, Board.is_default).where(
                    Board.id == board_id,
                    Board.workspace_id == require_tenant().workspace_id,
                )
            )
        ).first()
        return (linha.team_id, linha.is_default) if linha else None

    async def list_visible(self) -> list[tuple[Board, list[BoardColumn]]]:
        """Quadros que o usuario alcanca, com as colunas de cada (por `position`).

        `visiveis is None` (organizacao) tira so o filtro de time; o de
        workspace vale sempre. Quadro sem coluna volta com lista vazia.
        """
        tenant = require_tenant()
        visiveis = team_scope.visible_team_ids(
            tenant.memberships,
            tenant.team_tree,
            org_role=tenant.org_role,
        )

        consulta = (
            select(Board)
            .where(Board.workspace_id == tenant.workspace_id)
            .where(Board.deleted_at.is_(None))
            .order_by(Board.is_default.desc(), Board.name)
        )
        if visiveis is not None:
            consulta = consulta.where(Board.team_id.in_(visiveis))

        quadros = list((await self.session.execute(consulta)).scalars().all())
        if not quadros:
            return []

        ids = [q.id for q in quadros]
        colunas = list(
            (
                await self.session.execute(
                    select(BoardColumn)
                    .where(BoardColumn.workspace_id == tenant.workspace_id)
                    .where(BoardColumn.board_id.in_(ids))
                    .order_by(BoardColumn.board_id, BoardColumn.position)
                )
            )
            .scalars()
            .all()
        )

        por_quadro: dict[uuid.UUID, list[BoardColumn]] = {i: [] for i in ids}
        for coluna in colunas:
            por_quadro[coluna.board_id].append(coluna)

        return [(q, por_quadro[q.id]) for q in quadros]
