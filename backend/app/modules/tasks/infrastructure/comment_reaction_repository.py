"""Repository das reacoes no comentario (Spec 050).

CommentReaction tem workspace_id -> herda BaseRepository (leituras escopadas
por tenant). Metodos:
    - upsert: poe ou troca a reacao de uma pessoa, e diz se ela NASCEU;
    - remove: tira (DELETE fisico, como o watcher);
    - summaries_for_comments: a fileira de VARIOS comentarios numa query so.
"""

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
        """Poe ou troca a reacao de `user_id` no comentario. True se NASCEU.

        ⚠️⚠️ UMA OPERACAO, e nao SELECT + INSERT (spec §4.2). Dois cliques
        rapidos sao duas requisicoes; ler antes de escrever deixaria as duas
        passarem. Quem garante "uma por pessoa" e o UNIQUE, e o `ON CONFLICT`
        transforma a segunda em troca.

        ⚠️ E QUEM DIZ "NASCEU" E O BANCO, na mesma operacao: `xmax = 0` so vale
        para a linha recem-inserida. A fatia B notifica so quando nasce
        (decisao dela: trocar nao notifica) -- um SELECT antes teria a mesma
        janela, e dois cliques rapidos gerariam duas notificacoes.

        ⚠️ O `WHERE` do `DO UPDATE` pula a escrita quando o emoji e o MESMO. Sem
        ele, reagir de novo com o mesmo emoji regravaria `updated_at` e a
        pilula mudaria de lugar na fileira sem nada ter mudado. Nesse caso o
        `RETURNING` volta vazio -- e nao nasceu nada.
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
        """A fileira de VARIOS comentarios em UMA query (evita N+1 no thread).

        Mesmo desenho de `list_user_ids_for_tasks` (ADR 0025). Comentario sem
        reacao NAO aparece no dict -- quem chama usa `.get(id, ())`.

        ⚠️ NAO FILTRA COMENTARIO APAGADO, e de proposito: quem decide o que
        mandar e o service, que so pede ids de comentario ATIVO (spec §4.6 --
        as reacoes seguem a marca do comentario).
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
