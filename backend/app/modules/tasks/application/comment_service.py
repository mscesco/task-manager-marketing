"""Casos de uso de comentarios.

Visibilidade do comentario = visibilidade da task (via TaskScopeGuards).
Commit no UoW (router). Comentario nao entra no task_history.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Comment, Task, User
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
    user_ids_that_can_view_task,
)
from app.modules.tasks.domain.comment import (
    assert_reply_target,
    can_delete,
    can_edit,
    extract_mentions,
    mask_content,
    normalize_content,
)
from app.modules.tasks.domain.comment_reaction import (
    ReactionSummary,
    normalize_emoji,
)
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
    TaskWatcherRepository,
)
from app.modules.tasks.infrastructure.comment_reaction_repository import (
    CommentReactionRepository,
)
from app.modules.tasks.infrastructure.comment_repository import CommentRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

#: Permissao que habilita apagar comentario alheio.
_MODERATE_PERMISSION = "task.delete"


@dataclass(frozen=True, slots=True)
class CommentDTO:
    """Projecao de um comentario pra API (ja com tombstone resolvido)."""

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    content: str
    edited_at: datetime | None
    created_at: datetime
    is_deleted: bool
    #: Sem default: todo `_to_dto` tem de dizer de onde vem a fileira.
    reactions: tuple[ReactionSummary, ...]


class CommentService:
    """Comentarios de uma task. Commit no UoW (router)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tasks = TaskRepository(session)
        self._comments = CommentRepository(session)
        self._guards = TaskScopeGuards(session)
        self._assignees = TaskAssignmentRepository(session)
        self._watchers = TaskWatcherRepository(session)
        self._notify = NotificationEmitter(session)
        self._reactions = CommentReactionRepository(session)

    async def list_comments(
        self, *, task_id: uuid.UUID, params: PageParams
    ) -> Page[CommentDTO]:
        """Thread paginado da task. Exige enxergar a task (404 senao)."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)

        items, total = await self._comments.list_for_task(
            task_id=task_id, limit=params.limit, offset=params.offset
        )
        # Reacoes da pagina numa query so; comentario apagado nao tem fileira.
        reacoes = await self._reactions.summaries_for_comments(
            [c.id for c in items if c.deleted_at is None]
        )
        dtos = [self._to_dto(c, reactions=reacoes.get(c.id, ())) for c in items]
        return Page(items=dtos, total=total, page=params.page, size=params.size)

    async def _emitir_mencoes(
        self,
        *,
        task: Task,
        comment_id: uuid.UUID,
        conteudo: str,
        ja_mencionados: set[uuid.UUID] | None = None,
    ) -> list[uuid.UUID]:
        """Extrai, filtra e emite TASK_MENTIONED. Devolve quem foi notificado.

        Ordem dos filtros: usuarios reais do workspace (id invalido quebraria o
        INSERT e derrubaria todas as mencoes), depois quem enxerga a task (senao
        o aviso leva a 404 e vaza o titulo). `ja_mencionados` sao pulados.
        O emitter deduplica e exclui o autor.
        """
        tenant = require_tenant()
        mencionados = extract_mentions(conteudo)
        if ja_mencionados:
            mencionados = [m for m in mencionados if m not in ja_mencionados]
        if not mencionados:
            return []

        validos = set(
            (
                await self._session.execute(
                    select(User.id).where(
                        User.id.in_(mencionados),
                        User.workspace_id == tenant.workspace_id,
                    )
                )
            ).scalars().all()
        )
        mencionados = [m for m in mencionados if m in validos]
        if mencionados:
            alcancam = await user_ids_that_can_view_task(
                self._session, task=task, user_ids=mencionados
            )
            mencionados = [m for m in mencionados if m in alcancam]
        if mencionados:
            await self._notify.mentioned(
                recipient_ids=mencionados,
                actor_id=tenant.user_id,
                task_id=task.id,
                task_title=task.title,
                comment_id=comment_id,
            )
        return mencionados

    async def create_comment(
        self,
        *,
        task_id: uuid.UUID,
        content: str,
        parent_comment_id: uuid.UUID | None = None,
    ) -> CommentDTO:
        """Cria um comentario. Quem enxerga a task comenta.

        Se for replica, valida o alvo (1 nivel, mesma task).
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        clean = normalize_content(content)

        parent: Comment | None = None
        if parent_comment_id is not None:
            parent = await self._comments.get_by_id(parent_comment_id)
            if parent is None:  # inexistente ou ja apagado
                raise ValidationError(
                    "Comentario-pai inexistente.",
                    details={"field": "parent_comment_id"},
                )
            assert_reply_target(
                parent_task_id=parent.task_id,
                parent_parent_comment_id=parent.parent_comment_id,
                task_id=task_id,
            )

        tenant = require_tenant()
        comment = Comment(
            workspace_id=tenant.workspace_id,
            task_id=task_id,
            user_id=tenant.user_id,
            parent_comment_id=parent_comment_id,
            content=clean,
        )
        self._comments.add(comment)
        await self._session.flush()

        # Ninguem recebe duas notificacoes pelo mesmo comentario: mencao > resposta > fan-out.
        mencionados = await self._emitir_mencoes(
            task=task, comment_id=comment.id, conteudo=clean
        )

        # Autor do comentario respondido e avisado mesmo sem seguir a tarefa.
        avisados = set(mencionados)
        if parent is not None and parent.user_id not in avisados:
            await self._notify.comment_replied(
                recipient_id=parent.user_id,
                actor_id=tenant.user_id,
                task_id=task_id,
                task_title=task.title,
                comment_id=comment.id,
            )
            avisados.add(parent.user_id)

        # Fan-out para seguidores, responsaveis e criador, cada um com seu papel.
        papeis: dict[uuid.UUID, list[str]] = {}
        for uid in await self._watchers.list_user_ids(task_id):
            papeis.setdefault(uid, []).append("watcher")
        for uid in await self._assignees.list_user_ids(task_id):
            papeis.setdefault(uid, []).append("assignee")
        papeis.setdefault(task.created_by, []).append("creator")
        recipient_ids = [u for u in papeis if u not in avisados]
        await self._notify.comment_on_task(
            recipient_ids=recipient_ids,
            papeis=papeis,
            actor_id=tenant.user_id,
            task_id=task_id,
            task_title=task.title,
            comment_id=comment.id,
        )

        logger.info(
            "comment.created",
            task_id=str(task_id),
            comment_id=str(comment.id),
            is_reply=parent_comment_id is not None,
        )
        return self._to_dto(comment, reactions=())

    async def edit_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID, content: str
    ) -> CommentDTO:
        """Edita o conteudo. So o autor. Seta edited_at.

        Mencao acrescentada notifica; nao reemite TASK_COMMENTED.
        """
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        if not can_edit(author_id=comment.user_id, actor_id=tenant.user_id):
            raise AuthorizationError(
                "So o autor edita o proprio comentario."
            )

        # Ler antes de sobrescrever `comment.content`; depois, o delta sai vazio
        # e ninguem e notificado.
        antigas = set(extract_mentions(comment.content))

        clean = normalize_content(content)
        comment.content = clean
        comment.edited_at = datetime.now(UTC)
        await self._session.flush()

        task = await self._tasks.get_by_id_or_raise(task_id)
        novos = await self._emitir_mencoes(
            task=task,
            comment_id=comment.id,
            conteudo=clean,
            ja_mencionados=antigas,
        )

        logger.info(
            "comment.edited",
            comment_id=str(comment_id),
            mencoes_novas=len(novos),
        )
        # Editar nao tira as reacoes.
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    async def delete_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> None:
        """Soft-delete. Autor ou quem tem task.delete no time da tarefa."""
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        # Moderar exige o verbo no time da tarefa, nao em qualquer time.
        task = await self._tasks.get_by_id_or_raise(task_id)
        autorizado = can_delete(
            author_id=comment.user_id,
            actor_id=tenant.user_id,
            actor_can_moderate=tenant.has_permission_in(
                _MODERATE_PERMISSION, task.team_id
            ),
        )
        if not autorizado:
            raise AuthorizationError(
                "Sem permissao para apagar este comentario."
            )
        comment.deleted_at = datetime.now(UTC)
        await self._session.flush()

        logger.info("comment.deleted", comment_id=str(comment_id))

    async def set_reaction(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID, emoji: str
    ) -> CommentDTO:
        """Poe ou troca a reacao de quem chama. Quem ve a tarefa, reage.

        Erros:
            EntityNotFoundError -- tarefa invisivel, ou comentario inexistente,
                                   apagado ou de outra tarefa (`_load_active`).
            ValidationError     -- nao e exatamente um emoji (422).

        O 404 vem antes do 422, para lixo no corpo nao revelar que o comentario existe.
        """
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        normalizado = normalize_emoji(emoji)
        nasceu = await self._reactions.upsert(
            comment_id=comment.id,
            user_id=require_tenant().user_id,
            emoji=normalizado,
        )
        logger.info(
            "comment.reaction_set", comment_id=str(comment_id), created=nasceu
        )
        # So notifica quando a reacao nasce; trocar o emoji nao notifica.
        if nasceu:
            await self._notificar_autor_da_reacao(comment=comment, emoji=normalizado)
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    async def remove_reaction(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> CommentDTO:
        """Tira a reacao de quem chama. Tirar o que nao existe nao e erro."""
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        removeu = await self._reactions.remove(
            comment_id=comment.id, user_id=require_tenant().user_id
        )
        logger.info(
            "comment.reaction_removed", comment_id=str(comment_id), removed=removeu
        )
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    # ----------------------------------------------------
    # Helpers
    # ----------------------------------------------------
    async def _notificar_autor_da_reacao(self, *, comment: Comment, emoji: str) -> None:
        """Avisa o autor do comentario de que reagiram.

        So se ele ainda enxerga a tarefa (pode ter trocado de time desde que comentou).
        """
        ator = require_tenant().user_id
        if comment.user_id == ator:
            return
        task = await self._tasks.get_by_id_or_raise(comment.task_id)
        if not await user_can_view_task(
            self._session, task=task, user_id=comment.user_id
        ):
            return
        await self._notify.comment_reacted(
            recipient_id=comment.user_id,
            actor_id=ator,
            task_id=task.id,
            task_title=task.title,
            comment_id=comment.id,
            emoji=emoji,
        )

    async def _reacoes_de(self, comment: Comment) -> tuple[ReactionSummary, ...]:
        """A fileira de UM comentario (as rotas de reagir e o editar)."""
        reacoes = await self._reactions.summaries_for_comments([comment.id])
        return reacoes.get(comment.id, ())

    async def _load_active(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> Comment:
        """Carrega comentario ATIVO da task visivel. 404 se a task nao for
        vista, se o comentario nao existir/ja apagado, ou se for de outra task.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        comment = await self._comments.get_by_id_or_raise(comment_id)
        if comment.task_id != task_id:
            # comentario existe, mas nao e desta task -> 404 (nao vaza)
            raise EntityNotFoundError("Comment", identifier=comment_id)
        return comment

    @staticmethod
    def _to_dto(
        comment: Comment, *, reactions: tuple[ReactionSummary, ...]
    ) -> CommentDTO:
        is_deleted = comment.deleted_at is not None
        return CommentDTO(
            id=comment.id,
            task_id=comment.task_id,
            user_id=comment.user_id,
            parent_comment_id=comment.parent_comment_id,
            content=mask_content(comment.content, is_deleted=is_deleted),
            edited_at=comment.edited_at,
            created_at=comment.created_at,
            is_deleted=is_deleted,
            # Comentario apagado nao mostra reacao; as linhas ficam no banco.
            reactions=() if is_deleted else reactions,
        )
