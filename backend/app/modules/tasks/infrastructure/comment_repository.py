"""Repository de comentarios (Entrega 14).

Comment tem workspace_id -> herda BaseRepository (queries ja escopadas por
tenant e por soft-delete). Metodos especificos:
    - list_for_task: pagina do thread, created_at ASC, ja aplicando a regra
      de exibicao do tombstone (D5) no proprio SELECT, pra `total` e `items`
      nao divergirem;
    - add: insere (flush no service);
    - soft_delete_for_task_subtree: cascata da delecao de task (D11),
      EXCECAO AUTORIZADA ao _base_select (raw SQL, linhagem ADR 0003/0005).
"""

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
        """Comentarios visiveis da task, created_at ASC, paginado.

        Visivel = ativo OU (apagado e com ao menos uma replica ATIVA) -- o
        tombstone (D5). A condicao mora no SELECT pra `total` casar com o que
        de fato volta (senao paginacao mente). Retorna (itens_da_pagina, total).
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
            base.order_by(Comment.created_at.asc()).limit(limit).offset(offset)
        )
        items = list((await self.session.execute(page_stmt)).scalars().all())
        return items, total

    def add(self, comment: Comment) -> Comment:
        """Adiciona um comentario novo a sessao (sem commit)."""
        self.session.add(comment)
        return comment

    async def soft_delete_for_task_subtree(self, *, task_path: str) -> int:
        """Soft-delete dos comentarios de TODAS as tasks da subtree (D11).

        EXCECAO AUTORIZADA (mesma linhagem do soft_delete_subtree de task,
        ADR 0003/0005): raw SQL, escopado por tenant. Casa pelo `path` ltree
        da subtree -- nao depende de deleted_at das tasks (elas ja foram
        marcadas). NAO entra no cascade_count (esse conta so tarefas-filhas).
        Retorna o nº de comentarios afetados.
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
