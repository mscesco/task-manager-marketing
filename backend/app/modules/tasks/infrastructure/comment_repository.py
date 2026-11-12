"""Repository de comentarios."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import aliased

from app.core.tenant import require_tenant
from app.db.models import Comment
from app.db.repository import BaseRepository


class CommentRepository(BaseRepository[Comment]):
    """Acesso a dados de comentarios, escopado ao tenant corrente."""

    model = Comment

    async def list_for_task(
        self, *, task_id: uuid.UUID, limit: int, offset: int
    ) -> tuple[list[Comment], int]:
        """Comentarios visiveis da task, created_at ASC (desempate por id), paginado.

        Visivel = ativo OU (apagado e com replica ativa). A condicao fica no
        SELECT para `total` casar com os itens. Retorna (itens_da_pagina, total).
        """
        reply = aliased(Comment)
        tem_replica_ativa = (
            select(1)
            .where(
                reply.parent_comment_id == Comment.id,
                reply.workspace_id == Comment.workspace_id,
                reply.deleted_at.is_(None),
            )
            .exists()
        )
        base = (
            self._base_select(include_deleted=True)
            .where(Comment.task_id == task_id)
            .where(or_(Comment.deleted_at.is_(None), tem_replica_ativa))
        )

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        page_stmt = (
            base.order_by(Comment.created_at.asc(), Comment.id.asc())
            .limit(limit)
            .offset(offset)
        )
        items = list((await self.session.execute(page_stmt)).scalars().all())
        return items, total

    def add(self, comment: Comment) -> Comment:
        """Adiciona um comentario novo a sessao (sem commit)."""
        self.session.add(comment)
        return comment

    async def soft_delete_for_task_subtree(self, *, task_path: str) -> int:
        """Soft-delete dos comentarios de todas as tasks da subtree (raw SQL, por tenant).

        Casa pelo `path` ltree, sem depender do deleted_at das tasks. Retorna o nº afetado.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                UPDATE comment
                SET deleted_at = NOW()
                WHERE workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND task_id IN (
                    SELECT id FROM task
                    WHERE path <@ CAST(:task_path AS ltree)
                      AND workspace_id = :tenant_id
                  )
                """
            ),
            {"task_path": task_path, "tenant_id": tenant.workspace_id},
        )
        return result.rowcount or 0
