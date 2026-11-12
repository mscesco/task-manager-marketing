"""Repository das reacoes no comentario."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, literal_column
from sqlalchemy.dialects.postgresql import insert

from app.core.tenant import require_tenant
from app.db.models import CommentReaction
from app.db.repository import BaseRepository
from app.modules.tasks.domain.comment_reaction import (
    ReactionSummary,
    group_reactions,
)


class CommentReactionRepository(BaseRepository[CommentReaction]):
    """Acesso a dados de reacoes, escopado ao tenant corrente."""

    model = CommentReaction

    async def upsert(
        self, *, comment_id: uuid.UUID, user_id: uuid.UUID, emoji: str
    ) -> bool:
        """Poe ou troca a reacao de `user_id` no comentario. True se nasceu.

        Uma operacao so (ON CONFLICT), nao SELECT + INSERT: dois cliques rapidos
        disputariam. `xmax = 0` diz se a linha nasceu. O `WHERE` do `DO UPDATE`
        pula o mesmo emoji para nao regravar `updated_at` (a pilula mudaria de lugar).
        """
        tenant = require_tenant()
        stmt = insert(CommentReaction).values(
            workspace_id=tenant.workspace_id,
            comment_id=comment_id,
            user_id=user_id,
            emoji=emoji,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_comment_reaction_comment_user",
            set_={"emoji": stmt.excluded.emoji, "updated_at": func.now()},
            where=CommentReaction.emoji != stmt.excluded.emoji,
        ).returning(literal_column("(xmax = 0)"))
        nasceu = (await self.session.execute(stmt)).scalar_one_or_none()
        return bool(nasceu)

    async def remove(self, *, comment_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Tira a reacao (DELETE fisico). True se removeu, False se nao havia."""
        stmt = delete(CommentReaction).where(
            CommentReaction.workspace_id == require_tenant().workspace_id,
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0

    async def summaries_for_comments(
        self, comment_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[ReactionSummary, ...]]:
        """A fileira de varios comentarios em uma query (evita N+1 no thread).

        Comentario sem reacao nao aparece no dict. Nao filtra apagado: o service
        so pede ids de comentario ativo.
        """
        if not comment_ids:
            return {}
        stmt = (
            self._base_select()
            .with_only_columns(
                CommentReaction.comment_id,
                CommentReaction.emoji,
                CommentReaction.user_id,
            )
            .where(CommentReaction.comment_id.in_(comment_ids))
            .order_by(
                CommentReaction.comment_id,
                CommentReaction.updated_at.asc(),
                CommentReaction.id.asc(),
            )
        )
        rows = (await self.session.execute(stmt)).all()
        por_comentario: dict[uuid.UUID, list[tuple[str, uuid.UUID]]] = {}
        for comment_id, emoji, user_id in rows:
            por_comentario.setdefault(comment_id, []).append((emoji, user_id))
        return {
            comment_id: group_reactions(pares)
            for comment_id, pares in por_comentario.items()
        }
